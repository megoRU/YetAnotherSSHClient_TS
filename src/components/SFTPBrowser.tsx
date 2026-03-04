import React, {useEffect, useState, useCallback, useRef} from 'react';
import {File, Folder, RefreshCw, Home, ArrowUp, Download, Upload, Edit, Trash2} from 'lucide-react';

const {ipcRenderer} = window as any;

interface FileEntry {
    filename: string;
    longname: string;
    attrs: {
        mode: number;
        uid: number;
        gid: number;
        size: number;
        atime: number;
        mtime: number;
    };
}

interface Progress {
    remotePath: string;
    progress: number;
}

interface Props {
    id: string;
    config: any;
    visible?: boolean;
}

export const SFTPBrowser: React.FC<Props> = ({id, config, visible}) => {
    const [path, setPath] = useState('');
    const [files, setFiles] = useState<FileEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [status, setStatus] = useState('Подключение...');
    const [progress, setProgress] = useState<Record<string, number>>({});
    const [isDragging, setIsDragging] = useState(false);
    const isConnectingRef = useRef(false);

    const loadDirectory = useCallback(async (dirPath: string) => {
        setLoading(true);
        setError(null);
        try {
            const list = await ipcRenderer.invoke('sftp-readdir', {id, path: dirPath});
            const filteredList = list.filter((f: FileEntry) => f.filename !== '.' && f.filename !== '..');
            filteredList.sort((a: FileEntry, b: FileEntry) => {
                const aIsDir = (a.attrs.mode & 0o040000) !== 0;
                const bIsDir = (b.attrs.mode & 0o040000) !== 0;
                if (aIsDir && !bIsDir) return -1;
                if (!aIsDir && bIsDir) return 1;
                return a.filename.localeCompare(b.filename);
            });
            setFiles(filteredList);
            setPath(dirPath);
        } catch (err: any) {
            setError(err.message || String(err));
        } finally {
            setLoading(false);
        }
    }, [id]);

    useEffect(() => {
        const unsubStatus = ipcRenderer.on(`sftp-status-${id}`, (msg: string) => {
            setStatus(msg);
            if (msg === 'SFTP-сессия готова' && !isConnectingRef.current) {
                isConnectingRef.current = true;
                ipcRenderer.invoke('sftp-realpath', {id, path: '.'}).then((resolvedPath: string) => {
                    loadDirectory(resolvedPath);
                }).catch(() => {
                    loadDirectory('/');
                });
            }
        });

        const unsubError = ipcRenderer.on(`sftp-error-${id}`, (msg: string) => {
            setError(msg);
            setLoading(false);
        });

        const unsubProgress = ipcRenderer.on(`sftp-progress-${id}`, (data: Progress) => {
            setProgress(prev => ({
                ...prev,
                [data.remotePath]: data.progress
            }));
            if (data.progress >= 100) {
                setTimeout(() => {
                    setProgress(prev => {
                        const newProgress = {...prev};
                        delete newProgress[data.remotePath];
                        return newProgress;
                    });
                }, 2000);
            }
        });

        ipcRenderer.send('sftp-connect', {id, config});

        return () => {
            if (typeof unsubStatus === 'function') unsubStatus();
            if (typeof unsubError === 'function') unsubError();
            if (typeof unsubProgress === 'function') unsubProgress();
            ipcRenderer.send('ssh-close', id);
        };
    }, [id]);

    const handleNavigate = (filename: string, isDir: boolean) => {
        if (!isDir) return;
        const newPath = path === '/' ? `/${filename}` : `${path}/${filename}`.replace(/\/+/g, '/');
        loadDirectory(newPath);
    };

    const handleGoUp = () => {
        if (path === '/' || !path) return;
        const parts = path.split('/').filter(Boolean);
        parts.pop();
        const newPath = '/' + parts.join('/');
        loadDirectory(newPath);
    };

    const handleDownload = async (filename: string) => {
        const remotePath = `${path}/${filename}`.replace(/\/+/g, '/');
        try {
            await ipcRenderer.invoke('sftp-download-file', {id, remotePath, filename});
        } catch (err: any) {
            alert(`Ошибка загрузки: ${err.message}`);
        }
    };

    const handleUpload = async () => {
        try {
            const results = await ipcRenderer.invoke('sftp-upload-file', {id, remoteDir: path});
            if (results && results.length > 0) {
                loadDirectory(path);
            }
        } catch (err: any) {
            alert(`Ошибка загрузки: ${err.message}`);
        }
    };

    const handleEdit = async (filename: string) => {
        const remotePath = `${path}/${filename}`.replace(/\/+/g, '/');
        try {
            await ipcRenderer.invoke('sftp-open-in-editor', {id, remotePath, filename});
        } catch (err: any) {
            alert(`Ошибка открытия: ${err.message}`);
        }
    };

    const handleDelete = async (filename: string, isDir: boolean) => {
        if (!confirm(`Вы уверены, что хотите удалить ${filename}?`)) return;
        const remotePath = `${path}/${filename}`.replace(/\/+/g, '/');
        try {
            await ipcRenderer.invoke('sftp-rm', {id, path: remotePath, isDir});
            loadDirectory(path);
        } catch (err: any) {
            alert(`Ошибка удаления: ${err.message}`);
        }
    };

    const formatSize = (bytes: number) => {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    };

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(true);
    };

    const handleDragLeave = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(false);
    };

    const handleDrop = async (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(false);

        const files = Array.from(e.dataTransfer.files);
        if (files.length === 0) return;

        const filePaths = files.map(f => (f as any).path).filter(Boolean);
        if (filePaths.length === 0) return;

        try {
            const results = await ipcRenderer.invoke('sftp-upload-files-from-paths', {
                id,
                remoteDir: path,
                filePaths
            });
            if (results && results.length > 0) {
                loadDirectory(path);
            }
        } catch (err: any) {
            alert(`Ошибка загрузки: ${err.message}`);
        }
    };

    const displayStyle = visible ? 'flex' : 'none';

    return (
        <div
            className={`sftp-container ${isDragging ? 'dragging' : ''}`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            style={{
                display: displayStyle,
                flexDirection: 'column',
                height: '100%',
                width: '100%',
                background: 'var(--bg-color)',
                color: 'var(--text-color)',
                userSelect: 'none',
                position: 'relative'
            }}
        >
            {/* Toolbar */}
            <div className="sftp-toolbar" style={{
                padding: '10px',
                borderBottom: '1px solid var(--border-color)',
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                background: 'rgba(0,0,0,0.02)'
            }}>
                <button
                    onClick={handleGoUp}
                    disabled={path === '/' || !path || loading}
                    className="btn-secondary"
                    title="Наверх"
                    style={{padding: '5px', display: 'flex', alignItems: 'center'}}
                >
                    <ArrowUp size={18} />
                </button>
                <button
                    onClick={() => loadDirectory('/')}
                    disabled={loading}
                    className="btn-secondary"
                    title="Корень"
                    style={{padding: '5px', display: 'flex', alignItems: 'center'}}
                >
                    <Home size={18} />
                </button>
                <button
                    onClick={() => loadDirectory(path)}
                    disabled={loading}
                    className="btn-secondary"
                    title="Обновить"
                    style={{padding: '5px', display: 'flex', alignItems: 'center'}}
                >
                    <RefreshCw size={18} className={loading ? 'spin' : ''} />
                </button>
                <div style={{
                    flex: 1,
                    background: 'var(--input-bg)',
                    border: '1px solid var(--border-color)',
                    borderRadius: '4px',
                    padding: '5px 10px',
                    fontSize: '14px',
                    display: 'flex',
                    alignItems: 'center',
                    overflow: 'hidden',
                    whiteSpace: 'nowrap',
                    textOverflow: 'ellipsis'
                }}>
                    {path}
                </div>
                <button
                    onClick={handleUpload}
                    disabled={loading}
                    className="btn-primary"
                    style={{padding: '5px 15px', display: 'flex', alignItems: 'center', gap: '8px'}}
                >
                    <Upload size={18} />
                    Загрузить
                </button>
            </div>

            {/* Content */}
            <div className="sftp-content" style={{flex: 1, overflowY: 'auto', position: 'relative'}}>
                {(loading || status !== 'SFTP-сессия готова') && files.length === 0 && (
                    <div style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        right: 0,
                        bottom: 0,
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '15px',
                        zIndex: 5,
                        background: 'var(--bg-color)'
                    }}>
                        <div className="loading-spinner" />
                        <div style={{ fontWeight: 'bold' }}>{status}</div>
                    </div>
                )}

                {error && (
                    <div style={{padding: '20px', color: '#cc241d', background: 'rgba(204, 36, 29, 0.1)', margin: '10px', borderRadius: '4px'}}>
                        <strong>Ошибка:</strong> {error}
                    </div>
                )}

                {!loading && files.length === 0 && !error && (
                    <div style={{padding: '40px', textAlign: 'center', opacity: 0.5}}>
                        Папка пуста
                    </div>
                )}

                <table style={{width: '100%', borderCollapse: 'collapse', fontSize: '14px'}}>
                    <thead style={{
                        position: 'sticky',
                        top: 0,
                        background: 'var(--bg-color)',
                        zIndex: 1,
                        textAlign: 'left',
                        boxShadow: '0 1px 0 var(--border-color)'
                    }}>
                        <tr>
                            <th style={{padding: '10px', width: '30px'}}></th>
                            <th style={{padding: '10px'}}>Имя</th>
                            <th style={{padding: '10px', width: '100px'}}>Размер</th>
                            <th style={{padding: '10px', width: '150px'}}>Дата</th>
                            <th style={{padding: '10px', width: '150px'}}>Действия</th>
                        </tr>
                    </thead>
                    <tbody>
                        {files.map((file) => {
                            const isDir = (file.attrs.mode & 0o040000) !== 0;
                            const remotePath = `${path}/${file.filename}`.replace(/\/+/g, '/');
                            const currentProgress = progress[remotePath];

                            return (
                                <tr
                                    key={file.filename}
                                    className="sftp-row"
                                    onDoubleClick={() => handleNavigate(file.filename, isDir)}
                                    style={{cursor: isDir ? 'pointer' : 'default', position: 'relative'}}
                                >
                                    <td style={{padding: '8px 10px', textAlign: 'center'}}>
                                        {isDir ? <Folder size={18} color="#d79921" /> : <File size={18} opacity={0.7} />}
                                    </td>
                                    <td style={{padding: '8px 10px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'}}>
                                        {file.filename}
                                        {currentProgress !== undefined && (
                                            <div style={{fontSize: '10px', color: '#c81e51', marginTop: '2px'}}>
                                                {currentProgress === 100 ? 'Готово' : `Загрузка: ${currentProgress}%`}
                                                <div style={{width: '100px', height: '2px', background: 'rgba(0,0,0,0.1)', marginTop: '2px'}}>
                                                    <div style={{width: `${currentProgress}%`, height: '100%', background: '#c81e51'}} />
                                                </div>
                                            </div>
                                        )}
                                    </td>
                                    <td style={{padding: '8px 10px', opacity: 0.7}}>
                                        {isDir ? '--' : formatSize(file.attrs.size)}
                                    </td>
                                    <td style={{padding: '8px 10px', opacity: 0.7, fontSize: '12px'}}>
                                        {new Date(file.attrs.mtime * 1000).toLocaleString()}
                                    </td>
                                    <td style={{padding: '8px 10px'}}>
                                        <div style={{display: 'flex', gap: '5px'}}>
                                            {!isDir && (
                                                <>
                                                    <button onClick={() => handleDownload(file.filename)} title="Скачать" className="action-btn">
                                                        <Download size={14} />
                                                    </button>
                                                    <button onClick={() => handleEdit(file.filename)} title="Открыть в редакторе" className="action-btn">
                                                        <Edit size={14} />
                                                    </button>
                                                </>
                                            )}
                                            <button onClick={() => handleDelete(file.filename, isDir)} title="Удалить" className="action-btn danger">
                                                <Trash2 size={14} />
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>

            <style>{`
                .sftp-container.dragging::after {
                    content: 'Перетащите файлы сюда для загрузки';
                    position: absolute;
                    top: 0;
                    left: 0;
                    right: 0;
                    bottom: 0;
                    background: rgba(200, 30, 81, 0.1);
                    border: 2px dashed #c81e51;
                    display: flex;
                    alignItems: center;
                    justifyContent: center;
                    font-weight: bold;
                    color: #c81e51;
                    z-index: 100;
                    pointer-events: none;
                }
                .sftp-row:hover {
                    background: rgba(0,0,0,0.05);
                }
                .spin {
                    animation: spin 1s linear infinite;
                }
                @keyframes spin {
                    0% { transform: rotate(0deg); }
                    100% { transform: rotate(360deg); }
                }
                .loading-spinner {
                    width: 30px;
                    height: 30px;
                    border: 3px solid var(--border-color);
                    border-top: 3px solid #c81e51;
                    border-radius: 50%;
                    animation: spin 1s linear infinite;
                }
                .action-btn {
                    padding: 4px;
                    background: transparent;
                    border: 1px solid var(--border-color);
                    border-radius: 4px;
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    color: inherit;
                    opacity: 0.7;
                    transition: all 0.2s;
                }
                .action-btn:hover {
                    opacity: 1;
                    background: rgba(0,0,0,0.05);
                }
                .action-btn.danger:hover {
                    color: #cc241d;
                    border-color: #cc241d;
                }
            `}</style>
        </div>
    );
};
