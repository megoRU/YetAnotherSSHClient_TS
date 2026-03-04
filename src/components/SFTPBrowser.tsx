import React, {useEffect, useState, useCallback} from 'react';
import {File, Folder, RefreshCw, Home, ArrowUp} from 'lucide-react';

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

interface Props {
    id: string;
    config: any;
    visible?: boolean;
}

export const SFTPBrowser: React.FC<Props> = ({id, config, visible}) => {
    const [path, setPath] = useState('/');
    const [files, setFiles] = useState<FileEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [status, setStatus] = useState('Подключение...');

    const loadDirectory = useCallback(async (dirPath: string) => {
        setLoading(true);
        setError(null);
        try {
            const list = await ipcRenderer.invoke('sftp-readdir', {id, path: dirPath});
            // Filter out . and .. if they exist, and sort by type (folders first) then name
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
        const unsubStatus = ipcRenderer.on(`sftp-status-${id}`, (_: any, msg: string) => {
            setStatus(msg);
            if (msg === 'SFTP session ready') {
                loadDirectory('/');
            }
        });

        const unsubError = ipcRenderer.on(`sftp-error-${id}`, (_: any, msg: string) => {
            setError(msg);
            setLoading(false);
        });

        ipcRenderer.send('sftp-connect', {id, config});

        return () => {
            if (typeof unsubStatus === 'function') unsubStatus();
            if (typeof unsubError === 'function') unsubError();
            ipcRenderer.send('ssh-close', id);
        };
    }, [id]);

    const handleNavigate = (filename: string, isDir: boolean) => {
        if (!isDir) return;
        const newPath = path === '/' ? `/${filename}` : `${path}/${filename}`.replace(/\/+/g, '/');
        loadDirectory(newPath);
    };

    const handleGoUp = () => {
        if (path === '/') return;
        const parts = path.split('/').filter(Boolean);
        parts.pop();
        const newPath = '/' + parts.join('/');
        loadDirectory(newPath);
    };

    const formatSize = (bytes: number) => {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    };

    if (!visible && status !== 'SFTP session ready') return null;

    return (
        <div className="sftp-container" style={{
            display: 'flex',
            flexDirection: 'column',
            height: '100%',
            width: '100%',
            background: 'var(--bg-color)',
            color: 'var(--text-color)',
            userSelect: 'none'
        }}>
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
                    disabled={path === '/' || loading}
                    className="btn-secondary"
                    style={{padding: '5px', display: 'flex', alignItems: 'center'}}
                >
                    <ArrowUp size={18} />
                </button>
                <button
                    onClick={() => loadDirectory('/')}
                    disabled={loading}
                    className="btn-secondary"
                    style={{padding: '5px', display: 'flex', alignItems: 'center'}}
                >
                    <Home size={18} />
                </button>
                <button
                    onClick={() => loadDirectory(path)}
                    disabled={loading}
                    className="btn-secondary"
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
            </div>

            {/* Content */}
            <div className="sftp-content" style={{flex: 1, overflowY: 'auto', position: 'relative'}}>
                {loading && files.length === 0 && (
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
                        gap: '15px'
                    }}>
                        <div className="loading-spinner" />
                        <div>{status}</div>
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
                        {files.map((file) => {
                            const isDir = (file.attrs.mode & 0o040000) !== 0;
                            return (
                                <tr
                                    key={file.filename}
                                    className="sftp-row"
                                    onDoubleClick={() => handleNavigate(file.filename, isDir)}
                                    style={{cursor: isDir ? 'pointer' : 'default'}}
                                >
                                    <td style={{padding: '8px 10px', textAlign: 'center'}}>
                                        {isDir ? <Folder size={18} color="#d79921" /> : <File size={18} opacity={0.7} />}
                                    </td>
                                    <td style={{padding: '8px 10px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'}}>
                                        {file.filename}
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

            <style>{`
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
            `}</style>
        </div>
    );
};
