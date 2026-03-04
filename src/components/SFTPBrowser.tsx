import React, {useEffect, useState, useCallback, useRef} from 'react';
import {File, Folder, RefreshCw, Home, ArrowUp, Download, Upload, Edit, Trash2, Shield, MousePointer2, Archive} from 'lucide-react';
import {ContextMenu} from './ContextMenu';

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

    // Selection state
    const [selectedFilenames, setSelectedFilenames] = useState<string[]>([]);
    const [lastSelectedIndex, setLastSelectedIndex] = useState<number>(-1);

    // Context menu state
    const [contextMenu, setContextMenu] = useState<{ x: number, y: number, file?: FileEntry } | null>(null);

    // Modal states
    const [modal, setModal] = useState<{ type: 'delete' | 'rename' | 'permissions', file?: FileEntry } | null>(null);
    const [modalInput, setModalInput] = useState('');

    const isConnectingRef = useRef(false);

    const loadDirectory = useCallback(async (dirPath: string) => {
        setLoading(true);
        setError(null);
        setSelectedFilenames([]);
        setLastSelectedIndex(-1);
        try {
            const list = await ipcRenderer.invoke('sftp-readdir', {id, path: dirPath});
            const filteredList = list.filter((f: FileEntry) => !f.filename.startsWith('.'));
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
        // Prevent default behavior for drag and drop on the entire window
        const preventDefault = (e: DragEvent) => e.preventDefault();
        window.addEventListener('dragover', preventDefault);
        window.addEventListener('drop', preventDefault);

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
            window.removeEventListener('dragover', preventDefault);
            window.removeEventListener('drop', preventDefault);
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

    const handleDownload = async (filenames: string[]) => {
        if (filenames.length === 0) return;

        try {
            if (filenames.length === 1) {
                const filename = filenames[0];
                const remotePath = `${path}/${filename}`.replace(/\/+/g, '/');
                await ipcRenderer.invoke('sftp-download-file', {id, remotePath, filename});
            } else {
                const filesToDownload = filenames.map(filename => ({
                    filename,
                    remotePath: `${path}/${filename}`.replace(/\/+/g, '/')
                }));
                await ipcRenderer.invoke('sftp-download-multiple-files', {id, files: filesToDownload});
            }
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

    const handleDelete = async () => {
        const itemsToDelete = selectedFilenames.length > 0 ? selectedFilenames : (modal?.file ? [modal.file.filename] : []);
        if (itemsToDelete.length === 0) return;

        setLoading(true);
        try {
            for (const filename of itemsToDelete) {
                const file = files.find(f => f.filename === filename);
                if (!file) continue;
                const isDir = (file.attrs.mode & 0o040000) !== 0;
                const remotePath = `${path}/${filename}`.replace(/\/+/g, '/');
                await ipcRenderer.invoke('sftp-rm', {id, path: remotePath, isDir});
            }
            setModal(null);
            loadDirectory(path);
        } catch (err: any) {
            alert(`Ошибка удаления: ${err.message}`);
            setLoading(false);
        }
    };

    const handleRename = async () => {
        if (!modal?.file || !modalInput) return;
        const oldPath = `${path}/${modal.file.filename}`.replace(/\/+/g, '/');
        const newPath = `${path}/${modalInput}`.replace(/\/+/g, '/');
        try {
            await ipcRenderer.invoke('sftp-rename', {id, oldPath, newPath});
            setModal(null);
            loadDirectory(path);
        } catch (err: any) {
            alert(`Ошибка переименования: ${err.message}`);
        }
    };

    const handlePermissions = async () => {
        if (!modal?.file || !modalInput) return;
        const remotePath = `${path}/${modal.file.filename}`.replace(/\/+/g, '/');
        try {
            // mode from input (e.g. 755) to octal number
            const mode = parseInt(modalInput, 8);
            await ipcRenderer.invoke('sftp-chmod', {id, path: remotePath, mode});
            setModal(null);
            loadDirectory(path);
        } catch (err: any) {
            alert(`Ошибка изменения прав: ${err.message}`);
        }
    };

    const handleExtract = async (filename: string) => {
        const remotePath = `${path}/${filename}`.replace(/\/+/g, '/');
        setLoading(true);
        setStatus('Распаковка...');
        try {
            await ipcRenderer.invoke('sftp-extract', {id, remotePath});
            loadDirectory(path);
        } catch (err: any) {
            alert(`Ошибка распаковки: ${err.message}`);
            setLoading(false);
            setStatus('SFTP-сессия готова');
        }
    };

    const handleFileClick = (e: React.MouseEvent, filename: string, index: number) => {
        if (e.shiftKey && lastSelectedIndex !== -1) {
            const start = Math.min(lastSelectedIndex, index);
            const end = Math.max(lastSelectedIndex, index);
            const newSelection = files.slice(start, end + 1).map(f => f.filename);
            setSelectedFilenames(Array.from(new Set([...selectedFilenames, ...newSelection])));
        } else if (e.ctrlKey || e.metaKey) {
            setSelectedFilenames(prev =>
                prev.includes(filename) ? prev.filter(f => f !== filename) : [...prev, filename]
            );
            setLastSelectedIndex(index);
        } else {
            setSelectedFilenames([filename]);
            setLastSelectedIndex(index);
        }
    };

    const onFileContextMenu = (e: React.MouseEvent, file: FileEntry) => {
        e.preventDefault();
        e.stopPropagation();
        if (!selectedFilenames.includes(file.filename)) {
            setSelectedFilenames([file.filename]);
            setLastSelectedIndex(files.findIndex(f => f.filename === file.filename));
        }
        setContextMenu({
            x: e.clientX,
            y: e.clientY,
            file: file
        });
    };

    const handleDragEnter = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(true);
    };

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(true);
    };

    const handleDragLeave = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        // Only set to false if we leave the container itself, not its children
        if (e.currentTarget === e.target) {
            setIsDragging(false);
        }
    };

    const handleDrop = async (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(false);

        const droppedFiles = Array.from(e.dataTransfer.files);
        console.log('[SFTP] Dropped files count:', droppedFiles.length);
        if (droppedFiles.length === 0) return;

        // Try getting path from electron-specific webUtils if available,
        // fall back to f.path which works in some Electron configurations
        const filePaths = droppedFiles.map(f => {
            if (ipcRenderer.getPathForFile) return ipcRenderer.getPathForFile(f);
            return (f as any).path;
        }).filter(Boolean);

        console.log('[SFTP] Resolved file paths:', filePaths);
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

    const formatSize = (bytes: number) => {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    };

    const displayStyle = visible ? 'flex' : 'none';

    return (
        <div
            className={`sftp-container ${isDragging ? 'dragging' : ''}`}
            onDragEnter={handleDragEnter}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => {
                setSelectedFilenames([]);
                setLastSelectedIndex(-1);
            }}
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
            }} onClick={e => e.stopPropagation()}>
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
                        </tr>
                    </thead>
                    <tbody>
                        {files.map((file, index) => {
                            const isDir = (file.attrs.mode & 0o040000) !== 0;
                            const remotePath = `${path}/${file.filename}`.replace(/\/+/g, '/');
                            const currentProgress = progress[remotePath];
                            const isSelected = selectedFilenames.includes(file.filename);

                            return (
                                <tr
                                    key={file.filename}
                                    className={`sftp-row ${isSelected ? 'selected' : ''}`}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        handleFileClick(e, file.filename, index);
                                    }}
                                    onDoubleClick={(e) => {
                                        e.stopPropagation();
                                        if (isDir) {
                                            handleNavigate(file.filename, isDir);
                                        } else {
                                            handleEdit(file.filename);
                                        }
                                    }}
                                    onContextMenu={(e) => onFileContextMenu(e, file)}
                                    style={{cursor: 'pointer', position: 'relative'}}
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
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>

            {contextMenu && (
                <ContextMenu
                    x={contextMenu.x}
                    y={contextMenu.y}
                    onClose={() => setContextMenu(null)}
                    options={[
                        {
                            label: (contextMenu.file && (contextMenu.file.attrs.mode & 0o040000) !== 0) ? 'Перейти' : 'Открыть',
                            icon: <MousePointer2 size={14} />,
                            onClick: () => {
                                if (contextMenu.file) {
                                    const isDir = (contextMenu.file.attrs.mode & 0o040000) !== 0;
                                    if (isDir) {
                                        handleNavigate(contextMenu.file.filename, true);
                                    } else {
                                        handleEdit(contextMenu.file.filename);
                                    }
                                }
                            }
                        },
                        {
                            label: 'Переименовать',
                            icon: <Edit size={14} />,
                            onClick: () => {
                                if (contextMenu.file) {
                                    setModal({ type: 'rename', file: contextMenu.file });
                                    setModalInput(contextMenu.file.filename);
                                }
                            }
                        },
                        {
                            label: 'Права доступа',
                            icon: <Shield size={14} />,
                            onClick: () => {
                                if (contextMenu.file) {
                                    setModal({ type: 'permissions', file: contextMenu.file });
                                    setModalInput((contextMenu.file.attrs.mode & 0o777).toString(8));
                                }
                            }
                        },
                        {
                            label: 'Редактировать',
                            icon: <Edit size={14} />,
                            onClick: () => {
                                if (contextMenu.file) {
                                    handleEdit(contextMenu.file.filename);
                                }
                            }
                        },
                        {
                            label: 'Скачать',
                            icon: <Download size={14} />,
                            onClick: () => {
                                handleDownload(selectedFilenames);
                            }
                        },
                        {
                            label: 'Удалить',
                            icon: <Trash2 size={14} />,
                            danger: true,
                            onClick: () => {
                                setModal({ type: 'delete', file: contextMenu.file });
                            }
                        },
                        ...(contextMenu.file && !((contextMenu.file.attrs.mode & 0o040000) !== 0) && ['.zip', '.tar', '.gz', '.tgz', '.bz2'].some(ext => contextMenu.file!.filename.toLowerCase().endsWith(ext)) ? [{
                            label: 'Распаковать',
                            icon: <Archive size={14} />,
                            onClick: () => {
                                handleExtract(contextMenu.file!.filename);
                            }
                        }] : [])
                    ]}
                />
            )}

            {/* Custom Modals */}
            {modal && (
                <div style={{
                    position: 'absolute',
                    top: 0, left: 0, right: 0, bottom: 0,
                    background: 'rgba(0,0,0,0.5)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    zIndex: 2000
                }} onClick={() => setModal(null)}>
                    <div style={{
                        background: 'var(--bg-color)',
                        padding: '20px',
                        borderRadius: '8px',
                        width: '400px',
                        boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
                        border: '1px solid var(--border-color)'
                    }} onClick={e => e.stopPropagation()}>
                        <h3 style={{ marginTop: 0 }}>
                            {modal.type === 'delete' && 'Удаление'}
                            {modal.type === 'rename' && 'Переименование'}
                            {modal.type === 'permissions' && 'Права доступа'}
                        </h3>

                        {modal.type === 'delete' && (
                            <p>Вы уверены, что хотите удалить <b>{selectedFilenames.length > 1 ? `${selectedFilenames.length} элементов` : modal.file?.filename}</b>?</p>
                        )}

                        {(modal.type === 'rename' || modal.type === 'permissions') && (
                            <input
                                autoFocus
                                value={modalInput}
                                onChange={e => setModalInput(e.target.value)}
                                onKeyDown={e => e.key === 'Enter' && (modal.type === 'rename' ? handleRename() : handlePermissions())}
                                style={{
                                    width: '100%',
                                    padding: '8px',
                                    marginBottom: '20px',
                                    background: 'var(--input-bg)',
                                    color: 'var(--text-color)',
                                    border: '1px solid var(--border-color)',
                                    borderRadius: '4px'
                                }}
                            />
                        )}

                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                            <button className="btn-secondary" onClick={() => setModal(null)}>Отмена</button>
                            <button
                                className={modal.type === 'delete' ? 'btn-primary' : 'btn-primary'}
                                onClick={() => {
                                    if (modal.type === 'delete') handleDelete();
                                    else if (modal.type === 'rename') handleRename();
                                    else if (modal.type === 'permissions') handlePermissions();
                                }}
                            >
                                {modal.type === 'delete' ? 'Удалить' : 'Сохранить'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

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
                .sftp-row.selected {
                    background: rgba(200, 30, 81, 0.15) !important;
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
            `}</style>
        </div>
    );
};
