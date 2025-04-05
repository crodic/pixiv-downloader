const express = require('express');
const axios = require('axios');
const path = require('path');
const https = require('https');
const archiver = require('archiver');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001; // Different port from the original server

// Configure CORS if needed
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    next();
});

app.use(express.json());

const getConfig = (session) => {
    if (!session) throw new Error('PHPSESSID không được cấu hình. Vui lòng thêm cookie hợp lệ.');
    const config = {
        headers: {
            'User-Agent':
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            Referer: 'https://www.pixiv.net/',
            Cookie: `PHPSESSID=${session}`,
            Accept: 'application/json',
            Origin: 'https://www.pixiv.net',
            'Sec-Fetch-Site': 'same-origin',
            'Sec-Fetch-Mode': 'cors',
        },
        httpsAgent: new https.Agent({
            rejectUnauthorized: false,
        }),
    };
    return config;
};

async function getArtworkInfo(imageId, session) {
    const response = await axios.get(`https://www.pixiv.net/ajax/illust/${imageId}`, getConfig(session));

    if (!response.data.body) {
        throw new Error('Không thể lấy thông tin artwork');
    }

    return {
        pageCount: response.data.body.pageCount,
        title: response.data.body.title,
        urls: response.data.body.urls,
    };
}

const sanitizeFilename = (name) => name.replace(/[\/\\:*?"<>|]/g, '_');

app.post('/download-browser', async (req, res) => {
    try {
        let { imageId, folderName } = req.body;
        const session = req.body.session;

        if (imageId.includes('pixiv.net/en/artworks/')) {
            const match = imageId.match(/artworks\/(\d+)/);
            if (match && match[1]) {
                imageId = match[1];
            }
        }

        if (!folderName) {
            throw new Error('Tên folder không được để trống');
        }

        // Làm sạch tên folder
        let folderNameResult = sanitizeFilename(folderName);
        const artworkInfo = await getArtworkInfo(imageId, session);
        const artworkPageCount = artworkInfo.pageCount;

        // Browser mode with improved streaming approach
        const zipFileName = `${folderNameResult}_${imageId}.zip`;
        res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(zipFileName)}"`);
        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('X-Total-Pages', artworkPageCount); // Adding total pages info for frontend

        // Create zip archive with streaming
        const archive = archiver('zip', { zlib: { level: 6 } }); // Lower compression to improve performance

        // Set up archive size tracking to provide Content-Length
        let archiveSize = 0;
        archive.on('data', (chunk) => {
            archiveSize += chunk.length;
        });

        // Handle archive warnings (non-fatal errors)
        archive.on('warning', (err) => {
            if (err.code === 'ENOENT') {
                console.warn('Archive warning:', err);
            } else {
                console.error('Archive error:', err);
            }
        });

        // Handle archive errors
        archive.on('error', (err) => {
            console.error('Archive error:', err);
            // If response is still writable, send error
            if (!res.headersSent) {
                res.status(500).json({ error: 'Archive creation failed' });
            }
        });

        // Send progress events through headers
        let processedPages = 0;
        const sendProgress = () => {
            if (!res.headersSent) {
                res.setHeader('X-Progress', `${processedPages}/${artworkPageCount}`);
            }
        };

        // Pipe archive data to response
        archive.pipe(res);

        if (artworkPageCount > 1) {
            // Get all image pages info first
            const pagesResponse = await axios.get(
                `https://www.pixiv.net/ajax/illust/${imageId}/pages`,
                getConfig(session)
            );
            const pages = pagesResponse.data.body;

            // Use promise pool pattern to limit concurrency
            const MAX_CONCURRENT = 3; // Maximum concurrent downloads
            const queue = [...pages];
            const activePromises = new Set();

            // Process queue until empty
            let index = 0;
            while (queue.length > 0 || activePromises.size > 0) {
                // Fill the active promises pool
                while (activePromises.size < MAX_CONCURRENT && queue.length > 0) {
                    const page = queue.shift();
                    const currentIndex = index++;
                    const imageUrl = page.urls.original;
                    const fileName = `${folderNameResult}_${imageId}_p${currentIndex}.jpg`;

                    // Create a promise for this download
                    const downloadPromise = (async () => {
                        try {
                            // Stream download directly to the archive
                            const response = await axios({
                                method: 'get',
                                url: imageUrl,
                                responseType: 'stream',
                                headers: {
                                    ...getConfig(session).headers,
                                    Referer: `https://www.pixiv.net/en/artworks/${imageId}`,
                                },
                                timeout: 500000, // 5m timeout
                            });

                            // Add the file to archive
                            archive.append(response.data, { name: fileName });

                            // Update progress counter
                            processedPages++;
                            sendProgress();
                        } catch (error) {
                            console.error(`Error downloading image ${currentIndex}:`, error.message);
                            // Add error text file
                            archive.append(Buffer.from(`Failed to download image: ${error.message}`), {
                                name: `${fileName}.error.txt`,
                            });

                            // Still count as processed
                            processedPages++;
                            sendProgress();
                        } finally {
                            // Remove this promise from active set when done
                            activePromises.delete(downloadPromise);
                        }
                    })();

                    // Add to active set
                    activePromises.add(downloadPromise);
                }

                // Wait for any promise to complete if we've reached max concurrency
                if (activePromises.size >= MAX_CONCURRENT || (queue.length === 0 && activePromises.size > 0)) {
                    await Promise.race(Array.from(activePromises));
                }
            }
        } else {
            // Single image case
            try {
                const imageUrl = artworkInfo.urls.original;
                const fileName = `${folderNameResult}_${imageId}_p0.jpg`;

                const response = await axios({
                    method: 'get',
                    url: imageUrl,
                    responseType: 'stream',
                    headers: {
                        ...getConfig(session).headers,
                        Referer: `https://www.pixiv.net/en/artworks/${imageId}`,
                    },
                });

                archive.append(response.data, { name: fileName });
                processedPages = 1;
                sendProgress();
            } catch (error) {
                console.error('Error downloading single image:', error.message);
                archive.append(Buffer.from(`Failed to download image: ${error.message}`), {
                    name: `${folderNameResult}_${imageId}_p0.jpg.error.txt`,
                });
                processedPages = 1;
                sendProgress();
            }
        }

        // Finalize archive
        archive.finalize();
    } catch (error) {
        console.error('Error:', error.message);
        res.status(500).json({
            error: error.message,
            details: 'Vui lòng kiểm tra thông tin nhập vào',
        });
    }
});

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index2.html')));
app.listen(PORT, () => console.log(`Browser Mode Server chạy trên port ${PORT}`));
