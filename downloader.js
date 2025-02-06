const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const https = require('https');
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

const validateConfig = (session) => {
    if (!session) {
        throw new Error('PHPSESSID không được cấu hình. Vui lòng thêm cookie hợp lệ.');
    }
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

// Endpoint mới để tải ảnh trực tiếp qua trình duyệt
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

        // Thiết lập headers để trigger download
        res.setHeader('Content-Disposition', `attachment; filename="${filename || `${imageId}_p${page}.jpg`}"`);
        res.setHeader('Content-Type', 'image/jpeg');

        // Proxy hình ảnh từ Pixiv
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

// Cập nhật endpoint download để hỗ trợ hai chế độ
app.post('/download', async (req, res) => {
    try {
        const { imageId, folderName, mode = 'server' } = req.body;
        const session = req.body.session;

        if (!['server', 'browser'].includes(mode)) {
            throw new Error('Chế độ không hợp lệ. Dùng "server" hoặc "browser"');
        }

        if (!folderName) {
            throw new Error('Tên folder không được để trống');
        }

        const artworkInfo = await getArtworkInfo(imageId, session);
        const pageCount = artworkInfo.pageCount;

        if (mode === 'server') {
            const downloadsPath = path.join(__dirname, 'downloads');
            if (!fs.existsSync(downloadsPath)) {
                fs.mkdirSync(downloadsPath);
            }

            const sanitizeFilename = (name) => name.replace(/[\/\\:*?"<>|]/g, '_');

            const downloadPath = path.join(downloadsPath, sanitizeFilename(folderName));
            if (!fs.existsSync(downloadPath)) {
                fs.mkdirSync(downloadPath);
            }

            const results = [];
            const errors = [];

            // Tải các trang từ API pages nếu có nhiều trang
            if (pageCount > 1) {
                const pagesInfo = await axios.get(
                    `https://www.pixiv.net/ajax/illust/${imageId}/pages`,
                    getConfig(session)
                );

                for (let i = 0; i < pagesInfo.data.body.length; i++) {
                    try {
                        const imageUrl = pagesInfo.data.body[i].urls.original;
                        const fileName = `${folderName}_${imageId}_p${i}.jpg`;
                        const filePath = path.join(downloadPath, fileName);

                        if (!fs.existsSync(filePath)) {
                            await new Promise((resolve, reject) => {
                                const writer = fs.createWriteStream(filePath);
                                axios({
                                    method: 'get',
                                    url: imageUrl,
                                    responseType: 'stream',
                                    headers: {
                                        ...getConfig(session).headers,
                                        Referer: `https://www.pixiv.net/en/artworks/${imageId}`,
                                    },
                                })
                                    .then((response) => {
                                        response.data.pipe(writer);
                                        writer.on('finish', resolve);
                                        writer.on('error', reject);
                                    })
                                    .catch(reject);
                            });
                        }

                        results.push({
                            page: i,
                            fileName: fileName,
                            path: `/downloads/${folderName}/${fileName}`,
                        });
                    } catch (error) {
                        errors.push(`Lỗi khi tải ảnh trang ${i}: ${error.message}`);
                    }
                }
            } else {
                // Trường hợp chỉ có một ảnh
                try {
                    const imageUrl = artworkInfo.urls.original;
                    const fileName = `${folderName}_${imageId}_p0.jpg`;
                    const filePath = path.join(downloadPath, fileName);

                    if (!fs.existsSync(filePath)) {
                        await new Promise((resolve, reject) => {
                            const writer = fs.createWriteStream(filePath);
                            axios({
                                method: 'get',
                                url: imageUrl,
                                responseType: 'stream',
                                headers: {
                                    ...getConfig(session).headers,
                                    Referer: `https://www.pixiv.net/en/artworks/${imageId}`,
                                },
                            })
                                .then((response) => {
                                    response.data.pipe(writer);
                                    writer.on('finish', resolve);
                                    writer.on('error', reject);
                                })
                                .catch(reject);
                        });
                    }

                    results.push({
                        page: 0,
                        fileName: fileName,
                        path: `/downloads/${folderName}/${fileName}`,
                    });
                } catch (error) {
                    errors.push(`Lỗi khi tải ảnh: ${error.message}`);
                }
            }

            res.json({
                success: true,
                folderName: folderName,
                imageId: imageId,
                title: artworkInfo.title,
                totalPages: pageCount,
                downloadedFiles: results,
                errors: errors,
            });
        } else {
            // Mode browser: trước đây bạn tạo file ZIP trên ổ đĩa, giờ thay bằng streaming
            const zipFileName = `${folderName}_${imageId}.zip`;
            // Thiết lập header cho file ZIP
            res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(zipFileName)}"`);
            res.setHeader('Content-Type', 'application/zip');

            // Tạo archive và pipe trực tiếp vào response
            const archive = require('archiver')('zip', { zlib: { level: 9 } });
            archive.on('error', (err) => {
                throw err;
            });
            archive.pipe(res);

            if (pageCount > 1) {
                const pagesInfo = await axios.get(
                    `https://www.pixiv.net/ajax/illust/${imageId}/pages`,
                    getConfig(session)
                );
                for (let i = 0; i < pagesInfo.data.body.length; i++) {
                    const imageUrl = pagesInfo.data.body[i].urls.original;
                    const fileName = `${folderName}_${imageId}_p${i}.jpg`;
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
                const fileName = `${folderName}_${imageId}_p0.jpg`;
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

            // Khi tất cả ảnh đã được thêm vào archive, finalize để kết thúc stream
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

// [Phần còn lại giữ nguyên]
app.use('/downloads', express.static('downloads'));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.listen(PORT, () => console.log(`Server chạy trên port ${PORT}`));
