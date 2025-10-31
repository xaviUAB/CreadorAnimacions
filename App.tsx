import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Frame } from './types';
import { readFileAsDataURL, createZipAndDownload, downloadURI } from './utils/fileUtils';

const LOCAL_STORAGE_KEY = 'animationCreatorState';

const App: React.FC = () => {
    // State for core data
    const [frames, setFrames] = useState<Frame[]>([]);
    const [animationSpeed, setAnimationSpeed] = useState<number>(500);
    const [backgroundColor, setBackgroundColor] = useState<string>('#f3f4f6');
    const [currentFrameIndex, setCurrentFrameIndex] = useState<number>(0);
    
    // State for UI and interactions
    const [isPlaying, setIsPlaying] = useState<boolean>(false);
    const [isSavePanelVisible, setIsSavePanelVisible] = useState<boolean>(false);
    const [isVideoModalVisible, setIsVideoModalVisible] = useState<boolean>(false);
    const [videoFile, setVideoFile] = useState<File | null>(null);
    const [videoDuration, setVideoDuration] = useState<number>(0);
    const [trimStart, setTrimStart] = useState<number>(0);
    const [trimEnd, setTrimEnd] = useState<number>(0);
    const [extractionFps, setExtractionFps] = useState<number>(10);
    const [isExtracting, setIsExtracting] = useState<boolean>(false);
    const [extractionProgress, setExtractionProgress] = useState('');
    
    const [panelWidth, setPanelWidth] = useState<number>(50); // Initial width in percentage
    const [isResizing, setIsResizing] = useState<boolean>(false);

    const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
    const [draggedItemIndex, setDraggedItemIndex] = useState<number | null>(null);

    const fileInputRef = useRef<HTMLInputElement>(null);
    const videoInputRef = useRef<HTMLInputElement>(null);
    const extractionAbortController = useRef<AbortController | null>(null);

    // --- State Serialization & Deserialization (for UI settings) ---
    useEffect(() => {
        try {
            const savedStateJSON = localStorage.getItem(LOCAL_STORAGE_KEY);
            if (savedStateJSON) {
                const savedState = JSON.parse(savedStateJSON);
                if (savedState.animationSpeed) setAnimationSpeed(savedState.animationSpeed);
                if (savedState.backgroundColor) setBackgroundColor(savedState.backgroundColor);
                if (savedState.panelWidth) setPanelWidth(savedState.panelWidth);
            }
        } catch (error) {
            console.error("Error al carregar l'estat des de localStorage:", error);
        }
    }, []);

    useEffect(() => {
        const stateToSave = {
            animationSpeed,
            backgroundColor,
            panelWidth,
        };
        try {
            localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(stateToSave));
        } catch (error) {
            console.error("Error al desar l'estat a localStorage:", error);
        }
    }, [animationSpeed, backgroundColor, panelWidth]);


    // --- Animation Logic (REFACTORED) ---
    const getEnabledFrames = useCallback(() => frames.filter(f => f.enabled), [frames]);

    useEffect(() => {
        const enabledFrames = getEnabledFrames();
        if (currentFrameIndex >= enabledFrames.length && enabledFrames.length > 0) {
            setCurrentFrameIndex(0);
        }
    }, [frames, currentFrameIndex, getEnabledFrames]);

    useEffect(() => {
        let interval: number | null = null;
        const enabledFrames = getEnabledFrames();

        if (isPlaying && enabledFrames.length > 1) {
            interval = window.setInterval(() => {
                setCurrentFrameIndex(prevIndex => (prevIndex + 1) % enabledFrames.length);
            }, animationSpeed);
        }

        return () => {
            if (interval) {
                clearInterval(interval);
            }
        };
    }, [isPlaying, animationSpeed, getEnabledFrames]);
    
    const togglePlay = () => {
        const enabledFrames = getEnabledFrames();
        if (enabledFrames.length > 1) {
            setIsPlaying(prev => !prev);
        } else {
            setIsPlaying(false);
        }
    };


    // --- File Handling ---
    const handleFilesSelected = async (files: FileList | null) => {
        if (!files) return;
        const imageFiles = Array.from(files).filter(file => file.type.startsWith('image/'));
        if (imageFiles.length === 0) return;

        const newFrames = await Promise.all(
            imageFiles.map(async file => {
                const url = await readFileAsDataURL(file);
                return { url, name: file.name, enabled: true };
            })
        );
        setFrames(prev => [...prev, ...newFrames]);
    };
    
    const handleVideoFileSelected = (files: FileList | null) => {
        const file = files?.[0];
        if (file && file.type.startsWith('video/')) {
            const videoElement = document.createElement('video');
            videoElement.preload = 'metadata';
            videoElement.src = URL.createObjectURL(file);
            videoElement.onloadedmetadata = () => {
                setVideoDuration(videoElement.duration);
                setTrimEnd(videoElement.duration);
                setTrimStart(0);
                URL.revokeObjectURL(videoElement.src);
                setVideoFile(file);
                setIsVideoModalVisible(true);
            };
        }
    };

    const handleExtractFrames = async () => {
        if (!videoFile) return;

        setIsExtracting(true);
        setExtractionProgress('Iniciant extracció...');
        extractionAbortController.current = new AbortController();
        const signal = extractionAbortController.current.signal;

        const videoElement = document.createElement('video');
        videoElement.src = URL.createObjectURL(videoFile);

        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');

        const extractedFrames: Frame[] = [];
        const interval = 1 / extractionFps;
        const totalFramesToExtract = Math.floor((trimEnd - trimStart) / interval);

        try {
            await new Promise<void>((resolve, reject) => {
                videoElement.onloadedmetadata = () => resolve();
                videoElement.onerror = reject;
            });
            
            canvas.width = videoElement.videoWidth;
            canvas.height = videoElement.videoHeight;

            for (let i = 0; i < totalFramesToExtract; i++) {
                if (signal.aborted) {
                    console.log('Extracció cancel·lada per l\'usuari.');
                    break;
                }
                const time = trimStart + i * interval;
                videoElement.currentTime = time;
                
                await new Promise<void>(resolve => {
                    videoElement.onseeked = () => resolve();
                });
                
                context?.drawImage(videoElement, 0, 0, canvas.width, canvas.height);
                const url = canvas.toDataURL('image/png');
                const name = `${videoFile.name.split('.')[0]}_frame_${String(i + 1).padStart(4, '0')}.png`;
                extractedFrames.push({ url, name, enabled: true });
                setExtractionProgress(`Extret fotograma ${i + 1} de ${totalFramesToExtract}`);
            }

            if (!signal.aborted) {
                 setFrames(prev => [...prev, ...extractedFrames]);
            }

        } catch (error) {
            console.error("Error durant l'extracció de fotogrames:", error);
        } finally {
            setIsExtracting(false);
            setIsVideoModalVisible(false);
            setVideoFile(null);
            URL.revokeObjectURL(videoElement.src);
        }
    };
    
    const cancelExtraction = () => {
        if (extractionAbortController.current) {
            extractionAbortController.current.abort();
        }
        setIsExtracting(false);
        setIsVideoModalVisible(false);
        setVideoFile(null);
    };

    const handleSave = () => {
        const name = (document.getElementById('saveName') as HTMLInputElement).value || 'animacio';
        const format = (document.getElementById('format') as HTMLSelectElement).value;
        const framesToSave = getEnabledFrames();
        
        if (framesToSave.length === 0) {
            alert("No hi ha fotogrames seleccionats per desar.");
            return;
        }
        
        if (format === 'zip') {
            createZipAndDownload(framesToSave, name);
        } else { // individual
            framesToSave.forEach((frame, index) => {
                setTimeout(() => downloadURI(frame.url, `${name}_${String(index+1).padStart(4,'0')}.png`), index * 200);
            });
        }
        setIsSavePanelVisible(false);
    };


    // --- Drag & Drop Logic ---
    const onDragStart = (e: React.DragEvent<HTMLLIElement>, index: number) => {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', String(index));
        setDraggedItemIndex(index);
    };

    const onDragOver = (e: React.DragEvent<HTMLLIElement>, index: number) => {
        e.preventDefault();
        if (draggedItemIndex === null || draggedItemIndex === index) {
            setDragOverIndex(null);
            return;
        }

        const rect = e.currentTarget.getBoundingClientRect();
        const midpoint = rect.top + rect.height / 2;
        
        if (e.clientY < midpoint) {
            setDragOverIndex(index);
        } else {
             setDragOverIndex(index + 1);
        }
    };
    
    const onDragLeave = () => {
         setDragOverIndex(null);
    };

    const onDrop = (e: React.DragEvent<HTMLUListElement>) => {
        e.preventDefault();
        if (draggedItemIndex === null || dragOverIndex === null) return;
        
        const movedFrame = frames[draggedItemIndex];
        const remainingFrames = frames.filter((_, i) => i !== draggedItemIndex);
        
        let finalIndex = dragOverIndex;
        if (draggedItemIndex < finalIndex) {
            finalIndex--;
        }

        const newFrames = [
            ...remainingFrames.slice(0, finalIndex),
            movedFrame,
            ...remainingFrames.slice(finalIndex)
        ];

        setFrames(newFrames);
        setDraggedItemIndex(null);
        setDragOverIndex(null);
    };

    // --- Resizing Logic ---
    const startResizing = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        setIsResizing(true);
    }, []);

    const stopResizing = useCallback(() => {
        setIsResizing(false);
    }, []);

    const onResize = useCallback((e: MouseEvent) => {
        if (isResizing) {
            const newWidth = (e.clientX / window.innerWidth) * 100;
            if (newWidth > 20 && newWidth < 80) { // Constraint resizing
                setPanelWidth(newWidth);
            }
        }
    }, [isResizing]);

    useEffect(() => {
        window.addEventListener('mousemove', onResize);
        window.addEventListener('mouseup', stopResizing);
        return () => {
            window.removeEventListener('mousemove', onResize);
            window.removeEventListener('mouseup', stopResizing);
        };
    }, [onResize, stopResizing]);
    
    // --- Render ---
    const enabledFrames = getEnabledFrames();
    const currentFrame = enabledFrames[currentFrameIndex];

    return (
        <div className="flex flex-col h-screen bg-gray-100">
            <div 
                className="flex flex-1 overflow-hidden" 
                onDrop={(e) => { e.preventDefault(); handleFilesSelected(e.dataTransfer.files); }}
                onDragOver={(e) => e.preventDefault()}
            >
                {/* Viewer Panel */}
                <div className="flex flex-col p-4 bg-white" style={{ width: `${panelWidth}%`}}>
                    <div 
                        className="flex-1 flex items-center justify-center rounded-lg"
                        style={{ backgroundColor: backgroundColor }}
                    >
                        {frames.length === 0 ? (
                             <div className="text-center text-gray-500">
                                 <h2 className="text-2xl font-bold mb-2">Creador d'Animacions</h2>
                                 <p>Arrossega i deixa anar imatges o un vídeo aquí per començar</p>
                                 <div className="my-4">O</div>
                                 <button onClick={() => fileInputRef.current?.click()} className="bg-blue-500 text-white px-4 py-2 rounded-lg mr-2">Seleccionar Imatges</button>
                                 <button onClick={() => videoInputRef.current?.click()} className="bg-green-500 text-white px-4 py-2 rounded-lg">Importar Vídeo</button>
                                 <input type="file" ref={fileInputRef} onChange={(e) => handleFilesSelected(e.target.files)} multiple accept="image/*" className="hidden"/>
                                 <input type="file" ref={videoInputRef} onChange={(e) => handleVideoFileSelected(e.target.files)} accept="video/*" className="hidden"/>
                             </div>
                        ) : (
                            currentFrame ? (
                                <img src={currentFrame.url} alt={currentFrame.name} className="max-w-full max-h-full object-contain"/>
                            ) : (
                                <p className="text-gray-500">Selecciona almenys un fotograma per visualitzar</p>
                            )
                        )}
                    </div>
                     {frames.length > 0 && (
                        <div className="pt-4">
                            <div className="flex items-center justify-center space-x-4 mb-4">
                               <button onClick={() => setCurrentFrameIndex(p => (p - 1 + enabledFrames.length) % enabledFrames.length)} disabled={isPlaying || enabledFrames.length < 2}>&lt;</button>
                               <button onClick={togglePlay} className="px-4 py-2 rounded-lg text-white w-32" style={{backgroundColor: isPlaying ? '#ef4444' : '#22c55e'}}>
                                   {isPlaying ? 'Aturar' : 'Reproduir'}
                               </button>
                               <button onClick={() => setCurrentFrameIndex(p => (p + 1) % enabledFrames.length)} disabled={isPlaying || enabledFrames.length < 2}>&gt;</button>
                               <button onClick={() => setIsSavePanelVisible(true)} className="bg-indigo-500 text-white px-4 py-2 rounded-lg">💾 Desar</button>
                           </div>
                           <div className="flex items-center space-x-4">
                               <label htmlFor="speed">Velocitat (ms):</label>
                               <input type="range" id="speed" min="1" max="1000" value={animationSpeed} onChange={e => setAnimationSpeed(Number(e.target.value))} className="w-full"/>
                               <span>{animationSpeed}</span>
                               <label htmlFor="bgColor">Fons:</label>
                               <input type="color" id="bgColor" value={backgroundColor} onChange={e => setBackgroundColor(e.target.value)} />
                           </div>
                        </div>
                    )}
                </div>

                {/* Resizer */}
                <div className="resize-handle" onMouseDown={startResizing}></div>

                {/* Frames Panel */}
                <div className="flex flex-col p-4 bg-white" style={{ width: `calc(100% - ${panelWidth}% - 8px)`}}>
                    <h2 className="text-lg font-bold mb-2">Seqüència de Fotogrames ({enabledFrames.length} / {frames.length})</h2>
                    <div className="flex space-x-2 mb-2">
                        <button onClick={() => setFrames(frames.map(f => ({...f, enabled: true})))} className="flex-1 text-xs bg-gray-200 px-2 py-1 rounded">Seleccionar Tots</button>
                        <button onClick={() => setFrames(frames.map(f => ({...f, enabled: false})))} className="flex-1 text-xs bg-gray-200 px-2 py-1 rounded">Deseleccionar Tots</button>
                    </div>
                    <ul className="flex-1 overflow-y-auto" onDragLeave={onDragLeave} onDrop={onDrop}>
                        {dragOverIndex === 0 && <li className="drop-indicator"></li>}
                        {frames.map((frame, index) => (
                           <React.Fragment key={`${frame.name}-${index}`}>
                            <li
                                draggable
                                onDragStart={(e) => onDragStart(e, index)}
                                onDragOver={(e) => onDragOver(e, index)}
                                className={`list-item flex items-center p-2 rounded-lg space-x-2 ${draggedItemIndex === index ? 'dragging' : ''} ${!frame.enabled ? 'disabled' : ''} ${currentFrame?.url === frame.url && frames.length > 0 ? 'is-current' : ''}`}
                            >
                                <input type="checkbox" checked={frame.enabled} onChange={() => setFrames(frames.map((f, i) => i === index ? {...f, enabled: !f.enabled} : f))} />
                                <img src={frame.url} alt={frame.name} className="w-12 h-12 object-contain border rounded"/>
                                <span className="flex-1 truncate" title={frame.name}>{frame.name}</span>
                                <button onClick={() => setFrames(frames.filter((_, i) => i !== index))} className="text-red-500 font-bold">X</button>
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-gray-400 cursor-grab drag-handle" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <circle cx="12" cy="5" r="1"></circle>
                                    <circle cx="12" cy="12" r="1"></circle>
                                    <circle cx="12" cy="19" r="1"></circle>
                                    <circle cx="5" cy="5" r="1"></circle>
                                    <circle cx="5" cy="12" r="1"></circle>
                                    <circle cx="5" cy="19" r="1"></circle>
                                    <circle cx="19" cy="5" r="1"></circle>
                                    <circle cx="19" cy="12" r="1"></circle>
                                    <circle cx="19" cy="19" r="1"></circle>
                                </svg>

                            </li>
                            {dragOverIndex === index + 1 && <li className="drop-indicator"></li>}
                           </React.Fragment>
                        ))}
                    </ul>
                </div>
            </div>

            {/* Footer */}
            <footer className="text-center py-2 bg-gray-200 text-gray-600 text-xs">
                 <p>Desenvolupat per Xavier Ribes</p>
                 <p>GameLab - Departament de Comunicació Audiovisual i Publicitat de la UAB</p>
            </footer>

             {/* Save Panel */}
            {isSavePanelVisible && (
                 <div className="absolute bottom-0 left-0 right-0 bg-white p-4 shadow-2xl border-t">
                    <h3 className="text-lg font-bold">Desar Animació</h3>
                    <div className="my-2">
                        <label htmlFor="saveName" className="font-semibold">Nom del fitxer:</label>
                        <input type="text" id="saveName" defaultValue="animacio" className="border p-1 rounded ml-2"/>
                    </div>
                    <div className="my-2">
                        <label htmlFor="format" className="font-semibold">Format:</label>
                        <select id="format" className="border p-1 rounded ml-2">
                            <option value="zip">Fitxer ZIP (.zip)</option>
                            <option value="individual">Imatges Individuals</option>
                        </select>
                    </div>
                    <div className="mt-4">
                        <button onClick={handleSave} className="bg-blue-500 text-white px-4 py-2 rounded-lg">Confirmar i Desar</button>
                        <button onClick={() => setIsSavePanelVisible(false)} className="ml-2 text-gray-600">Cancel·lar</button>
                    </div>
                 </div>
             )}

            {/* Video Import Modal */}
            {isVideoModalVisible && (
                <div className="absolute inset-0 bg-black bg-opacity-50 flex items-center justify-center">
                    <div className="bg-white p-6 rounded-lg shadow-xl w-full max-w-md">
                        <h3 className="text-xl font-bold mb-4">Configurar Importació de Vídeo</h3>
                        {isExtracting ? (
                            <div>
                                <div className="spinner mx-auto mb-4"></div>
                                <p className="text-center">{extractionProgress}</p>
                                <button onClick={cancelExtraction} className="w-full mt-4 bg-red-500 text-white px-4 py-2 rounded-lg">Cancel·lar Procés</button>
                            </div>
                        ) : (
                            <>
                                <p className="mb-2">Durada total del vídeo: {videoDuration.toFixed(2)} segons.</p>
                                <div className="grid grid-cols-2 gap-4 mb-4">
                                    <div>
                                        <label htmlFor="trimStart">Inici (s):</label>
                                        <input type="number" id="trimStart" value={trimStart} onChange={e => setTrimStart(Number(e.target.value))} min="0" max={videoDuration} step="0.1" className="w-full border p-1 rounded"/>
                                    </div>
                                     <div>
                                        <label htmlFor="trimEnd">Final (s):</label>
                                        <input type="number" id="trimEnd" value={trimEnd} onChange={e => setTrimEnd(Number(e.target.value))} min="0" max={videoDuration} step="0.1" className="w-full border p-1 rounded"/>
                                    </div>
                                </div>
                                <div className="mb-4">
                                     <label htmlFor="fps">Fotogrames per segon (FPS):</label>
                                     <input type="number" id="fps" value={extractionFps} onChange={e => setExtractionFps(Number(e.target.value))} min="1" max="30" className="w-full border p-1 rounded"/>
                                </div>
                                <div>
                                    <button onClick={handleExtractFrames} className="w-full bg-blue-500 text-white px-4 py-2 rounded-lg">Processar Fragment</button>
                                    <button onClick={cancelExtraction} className="w-full mt-2 text-gray-600">Cancel·lar</button>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            )}

        </div>
    );
};

export default App;