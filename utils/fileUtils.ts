// Implemented utility functions for file handling, ZIP creation, and GIF generation.
import { Frame } from './types';
import JSZip from 'jszip';
import saveAs from 'file-saver';

/**
 * Reads a file and converts it to a Data URL string.
 * @param file The file to read.
 * @returns A promise that resolves with the Data URL.
 */
export const readFileAsDataURL = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
};

/**
 * Downloads a URI by creating a temporary link.
 * @param uri The URI to download (e.g., a Data URL).
 * @param name The name for the downloaded file.
 */
export const downloadURI = (uri: string, name: string) => {
    const link = document.createElement('a');
    link.href = uri;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
};

/**
 * Creates a ZIP file from a list of frames and initiates a download.
 * @param frames The frames to include in the ZIP.
 * @param name The base name for the ZIP file.
 */
export const createZipAndDownload = async (frames: Frame[], name:string): Promise<void> => {
    const zip = new JSZip();
    frames.forEach((frame, index) => {
        // Extract base64 data from the data URL
        const base64Data = frame.url.split(',')[1];
        const fileName = frame.name.split('.').slice(0, -1).join('.') || `${name}_${String(index + 1).padStart(4, '0')}`;
        const extension = frame.name.split('.').pop() || 'png';
        zip.file(`${fileName}.${extension}`, base64Data, { base64: true });
    });

    try {
        const content = await zip.generateAsync({ type: 'blob' });
        saveAs(content, `${name}.zip`);
    } catch (error) {
        console.error("Error creating ZIP file:", error);
    }
};
