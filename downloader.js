const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const https = require('https');
const archiver = require('archiver');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

const PHPSESSID = '33153236_lV0f640d75ruM1VNs0n9m8SXM0tbMGRG';

const getConfig = (session = PHPSESSID) => {
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

app.use(express.json());

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

app.get('/download-image/:imageId/:page', async (req, res) => {
    try {
        const { imageId, page } = req.params;
        const { filename } = req.query;
        const pageNum = parseInt(page, 10);
        const session = req.body.phpSessionId;

        // Lấy thông tin ảnh
        const artworkInfo = await getArtworkInfo(imageId, session);
        let imageUrl;

        if (artworkInfo.pageCount > 1) {
            const pagesInfo = await axios.get(`https://www.pixiv.net/ajax/illust/${imageId}/pages`, getConfig(session));
            imageUrl = pagesInfo.data.body[pageNum].urls.original;
        } else {
            imageUrl = artworkInfo.urls.original;
        }

        res.setHeader('Content-Disposition', `attachment; filename="${filename || `${imageId}_p${page}.jpg`}"`);
        res.setHeader('Content-Type', 'image/jpeg');

        const response = await axios({
            method: 'get',
            url: imageUrl,
            responseType: 'stream',
            headers: {
                ...getConfig(session).headers,
                Referer: `https://www.pixiv.net/en/artworks/${imageId}`,
            },
        });

        response.data.pipe(res);
    } catch (error) {
        console.error('Error:', error.message);
        res.status(500).send('Lỗi khi tải ảnh');
    }
});

app.post('/download-selected', async (req, res) => {
    try {
        const { selectedFiles, folderName } = req.body;
        const zipFileName = `${folderName}_selected.zip`;

        res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(zipFileName)}"`);
        res.setHeader('Content-Type', 'application/zip');

        const archive = archiver('zip', { zlib: { level: 9 } });
        archive.pipe(res);

        // Add each selected file to the archive
        for (const filePath of selectedFiles) {
            const fullPath = path.join(__dirname, filePath);
            if (fs.existsSync(fullPath)) {
                archive.file(fullPath, { name: path.basename(filePath) });
            }
        }

        archive.finalize();
    } catch (error) {
        console.error('Error:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// app.post('/download', async (req, res) => {
//     try {
//         const { imageId, folderName, mode = 'server' } = req.body;
//         const session = req.body.session;

//         if (!['server', 'browser'].includes(mode)) {
//             throw new Error('Chế độ không hợp lệ. Dùng "server" hoặc "browser"');
//         }

//         if (!folderName) {
//             throw new Error('Tên folder không được để trống');
//         }

//         let folderNameResult = sanitizeFilename(folderName);
//         const artworkInfo = await getArtworkInfo(imageId, session);
//         const pageCount = artworkInfo.pageCount;

//         if (mode === 'server') {
//             const results = [];
//             const errors = [];

//             // Xử lý nhiều trang
//             if (pageCount > 1) {
//                 const pagesInfo = await axios.get(
//                     `https://www.pixiv.net/ajax/illust/${imageId}/pages`,
//                     getConfig(session)
//                 );

//                 for (let i = 0; i < pagesInfo.data.body.length; i++) {
//                     try {
//                         const imageUrl = pagesInfo.data.body[i].urls.original;
//                         const fileName = `${folderNameResult}_${imageId}_p${i}.jpg`;

//                         // Tải ảnh và convert sang base64
//                         const response = await axios({
//                             method: 'get',
//                             url: imageUrl,
//                             responseType: 'arraybuffer',
//                             headers: {
//                                 ...getConfig(session).headers,
//                                 Referer: `https://www.pixiv.net/en/artworks/${imageId}`,
//                             },
//                         });

//                         const base64Image = Buffer.from(response.data, 'binary').toString('base64');

//                         results.push({
//                             page: i,
//                             fileName: fileName,
//                             base64Data: `data:image/jpeg;base64,${base64Image}`,
//                         });
//                     } catch (error) {
//                         errors.push(`Lỗi khi tải ảnh trang ${i}: ${error.message}`);
//                     }
//                 }
//             } else {
//                 // Xử lý một trang
//                 try {
//                     const imageUrl = artworkInfo.urls.original;
//                     const fileName = `${folderNameResult}_${imageId}_p0.jpg`;

//                     const response = await axios({
//                         method: 'get',
//                         url: imageUrl,
//                         responseType: 'arraybuffer',
//                         headers: {
//                             ...getConfig(session).headers,
//                             Referer: `https://www.pixiv.net/en/artworks/${imageId}`,
//                         },
//                     });

//                     const base64Image = Buffer.from(response.data, 'binary').toString('base64');

//                     results.push({
//                         page: 0,
//                         fileName: fileName,
//                         base64Data: `data:image/jpeg;base64,${base64Image}`,
//                     });
//                 } catch (error) {
//                     errors.push(`Lỗi khi tải ảnh: ${error.message}`);
//                 }
//             }

//             res.json({
//                 success: true,
//                 folderName: folderNameResult,
//                 imageId: imageId,
//                 title: artworkInfo.title,
//                 totalPages: pageCount,
//                 images: results,
//                 errors: errors,
//             });
//         } else {
//             // Mode browser: trước đây bạn tạo file ZIP trên ổ đĩa, giờ thay bằng streaming
//             const zipFileName = `${folderNameResult}_${imageId}.zip`;
//             // Thiết lập header cho file ZIP
//             res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(zipFileName)}"`);
//             res.setHeader('Content-Type', 'application/zip');

//             // Tạo archive và pipe trực tiếp vào response
//             const archive = require('archiver')('zip', { zlib: { level: 9 } });
//             archive.on('error', (err) => {
//                 throw err;
//             });
//             archive.pipe(res);

//             if (pageCount > 1) {
//                 const pagesInfo = await axios.get(
//                     `https://www.pixiv.net/ajax/illust/${imageId}/pages`,
//                     getConfig(session)
//                 );
//                 for (let i = 0; i < pagesInfo.data.body.length; i++) {
//                     const imageUrl = pagesInfo.data.body[i].urls.original;
//                     const fileName = `${folderNameResult}_${imageId}_p${i}.jpg`;
//                     const response = await axios({
//                         method: 'get',
//                         url: imageUrl,
//                         responseType: 'arraybuffer',
//                         headers: {
//                             ...getConfig(session).headers,
//                             Referer: `https://www.pixiv.net/en/artworks/${imageId}`,
//                         },
//                     });
//                     archive.append(response.data, { name: fileName });
//                 }
//             } else {
//                 const imageUrl = artworkInfo.urls.original;
//                 const fileName = `${folderNameResult}_${imageId}_p0.jpg`;
//                 const response = await axios({
//                     method: 'get',
//                     url: imageUrl,
//                     responseType: 'arraybuffer',
//                     headers: {
//                         ...getConfig(session).headers,
//                         Referer: `https://www.pixiv.net/en/artworks/${imageId}`,
//                     },
//                 });
//                 archive.append(response.data, { name: fileName });
//             }

//             // Khi tất cả ảnh đã được thêm vào archive, finalize để kết thúc stream
//             archive.finalize();
//         }
//     } catch (error) {
//         console.error('Error:', error.message);
//         res.status(500).json({
//             error: error.message,
//             details: 'Vui lòng kiểm tra thông tin nhập vào',
//         });
//     }
// });

app.post('/download', async (req, res) => {
    try {
        const { imageId, folderName, mode = 'server', page, limit } = req.body;
        const session = req.body.session;

        if (!['server', 'browser'].includes(mode)) {
            throw new Error('Chế độ không hợp lệ. Dùng "server" hoặc "browser"');
        }

        if (!folderName) {
            throw new Error('Tên folder không được để trống');
        }

        // Làm sạch tên folder
        let folderNameResult = sanitizeFilename(folderName);
        const artworkInfo = await getArtworkInfo(imageId, session);
        const artworkPageCount = artworkInfo.pageCount;

        if (mode === 'server') {
            const results = [];
            const errors = [];

            // Nếu ảnh đa trang thì áp dụng phân trang
            if (artworkPageCount > 1) {
                const pagesResponse = await axios.get(
                    `https://www.pixiv.net/ajax/illust/${imageId}/pages`,
                    getConfig(session)
                );
                const allPages = pagesResponse.data.body;
                const totalImages = allPages.length;
                // Thiết lập phân trang (mặc định trang 1, mỗi trang 5 ảnh)
                const currentPage = page && Number(page) > 0 ? Number(page) : 1;
                const perPage = limit && Number(limit) > 0 ? Number(limit) : 5;
                const totalPages = Math.ceil(totalImages / perPage);

                if (currentPage > totalPages) {
                    throw new Error(`Trang ${currentPage} không tồn tại. Tổng số trang là ${totalPages}.`);
                }

                // Lấy ra mảng con theo trang hiện tại
                const paginatedPages = allPages.slice((currentPage - 1) * perPage, currentPage * perPage);

                // Tải từng ảnh trong trang hiện tại
                for (let i = 0; i < paginatedPages.length; i++) {
                    try {
                        // Tính index thực của ảnh trong toàn bộ bộ ảnh
                        const actualIndex = (currentPage - 1) * perPage + i;
                        const imageUrl = paginatedPages[i].urls.original;
                        const fileName = `${folderNameResult}_${imageId}_p${actualIndex}.jpg`;

                        const response = await axios({
                            method: 'get',
                            url: imageUrl,
                            responseType: 'arraybuffer',
                            headers: {
                                ...getConfig(session).headers,
                                Referer: `https://www.pixiv.net/en/artworks/${imageId}`,
                            },
                        });

                        const base64Image = Buffer.from(response.data, 'binary').toString('base64');

                        results.push({
                            page: actualIndex,
                            fileName: fileName,
                            base64Data: `data:image/jpeg;base64,${base64Image}`,
                        });
                    } catch (error) {
                        errors.push(`Lỗi khi tải ảnh trang ${(currentPage - 1) * perPage + i}: ${error.message}`);
                    }
                }

                res.json({
                    success: true,
                    folderName: folderNameResult,
                    imageId: imageId,
                    title: artworkInfo.title,
                    totalArtworkPages: artworkPageCount,
                    pagination: {
                        currentPage,
                        perPage,
                        totalImages,
                        totalPages,
                    },
                    images: results,
                    errors: errors,
                });
            } else {
                // Ảnh chỉ có 1 trang, không cần phân trang
                try {
                    const imageUrl = artworkInfo.urls.original;
                    const fileName = `${folderNameResult}_${imageId}_p0.jpg`;

                    const response = await axios({
                        method: 'get',
                        url: imageUrl,
                        responseType: 'arraybuffer',
                        headers: {
                            ...getConfig(session).headers,
                            Referer: `https://www.pixiv.net/en/artworks/${imageId}`,
                        },
                    });

                    const base64Image = Buffer.from(response.data, 'binary').toString('base64');

                    results.push({
                        page: 0,
                        fileName: fileName,
                        base64Data: `data:image/jpeg;base64,${base64Image}`,
                    });
                } catch (error) {
                    errors.push(`Lỗi khi tải ảnh: ${error.message}`);
                }

                res.json({
                    success: true,
                    folderName: folderNameResult,
                    imageId: imageId,
                    title: artworkInfo.title,
                    totalArtworkPages: artworkPageCount,
                    pagination: {
                        currentPage: 1,
                        perPage: 1,
                        totalImages: 1,
                        totalPages: 1,
                    },
                    images: results,
                    errors: errors,
                });
            }
        } else {
            // Chế độ browser: giữ nguyên như cũ (tải toàn bộ ảnh và tạo file ZIP)
            const zipFileName = `${folderNameResult}_${imageId}.zip`;
            res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(zipFileName)}"`);
            res.setHeader('Content-Type', 'application/zip');

            const archive = require('archiver')('zip', { zlib: { level: 9 } });
            archive.on('error', (err) => {
                throw err;
            });
            archive.pipe(res);

            if (artworkPageCount > 1) {
                const pagesResponse = await axios.get(
                    `https://www.pixiv.net/ajax/illust/${imageId}/pages`,
                    getConfig(session)
                );

                for (let i = 0; i < pagesResponse.data.body.length; i++) {
                    const imageUrl = pagesResponse.data.body[i].urls.original;
                    const fileName = `${folderNameResult}_${imageId}_p${i}.jpg`;
                    const response = await axios({
                        method: 'get',
                        url: imageUrl,
                        responseType: 'arraybuffer',
                        headers: {
                            ...getConfig(session).headers,
                            Referer: `https://www.pixiv.net/en/artworks/${imageId}`,
                        },
                    });
                    archive.append(response.data, { name: fileName });
                }
            } else {
                const imageUrl = artworkInfo.urls.original;
                const fileName = `${folderNameResult}_${imageId}_p0.jpg`;
                const response = await axios({
                    method: 'get',
                    url: imageUrl,
                    responseType: 'arraybuffer',
                    headers: {
                        ...getConfig(session).headers,
                        Referer: `https://www.pixiv.net/en/artworks/${imageId}`,
                    },
                });
                archive.append(response.data, { name: fileName });
            }

            archive.finalize();
        }
    } catch (error) {
        console.error('Error:', error.message);
        res.status(500).json({
            error: error.message,
            details: 'Vui lòng kiểm tra thông tin nhập vào',
        });
    }
});

app.use('/downloads', express.static('downloads'));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.listen(PORT, () => console.log(`Server chạy trên port ${PORT}`));
