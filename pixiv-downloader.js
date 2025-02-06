// pixiv-downloader.js
const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const https = require('https');

const app = express();
const PORT = 3000;

const PHPSESSID = '33153236_lV0f640d75ruM1VNs0n9m8SXM0tbMGRG'; // Thêm PHPSESSID của bạn vào đây

const config = {
    headers: {
        'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Referer: 'https://www.pixiv.net/',
        Cookie: `PHPSESSID=${PHPSESSID}`,
        Accept: 'application/json',
        Origin: 'https://www.pixiv.net',
        'Sec-Fetch-Site': 'same-origin',
        'Sec-Fetch-Mode': 'cors',
    },
    httpsAgent: new https.Agent({
        rejectUnauthorized: false,
    }),
};

app.use(express.json());

const validateConfig = () => {
    if (!PHPSESSID) {
        throw new Error('PHPSESSID không được cấu hình. Vui lòng thêm cookie hợp lệ.');
    }
};

// Hàm lấy thông tin số trang của post
async function getArtworkInfo(imageId) {
    const response = await axios.get(`https://www.pixiv.net/ajax/illust/${imageId}`, config);

    if (!response.data.body) {
        throw new Error('Không thể lấy thông tin artwork');
    }

    return {
        pageCount: response.data.body.pageCount,
        title: response.data.body.title,
        urls: response.data.body.urls,
    };
}

// API endpoint để tải ảnh với tên folder tùy chỉnh
app.post('/download', async (req, res) => {
    try {
        validateConfig();
        const { imageId, folderName } = req.body;

        if (!folderName) {
            throw new Error('Tên folder không được để trống');
        }

        // Lấy thông tin artwork để biết số trang
        const artworkInfo = await getArtworkInfo(imageId);
        const pageCount = artworkInfo.pageCount;

        // Tạo thư mục downloads nếu chưa tồn tại
        const downloadsPath = path.join(__dirname, 'downloads');
        if (!fs.existsSync(downloadsPath)) {
            fs.mkdirSync(downloadsPath);
        }

        // Tạo thư mục con với tên được chỉ định
        const downloadPath = path.join(downloadsPath, folderName);
        if (!fs.existsSync(downloadPath)) {
            fs.mkdirSync(downloadPath);
        }

        const results = [];
        const errors = [];

        // Tải các trang từ API pages nếu có nhiều trang
        if (pageCount > 1) {
            const pagesInfo = await axios.get(`https://www.pixiv.net/ajax/illust/${imageId}/pages`, config);

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
                                    ...config.headers,
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
                                ...config.headers,
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
    } catch (error) {
        console.error('Error:', error.message);
        res.status(500).json({
            error: error.message,
            details: 'Vui lòng kiểm tra thông tin nhập vào',
        });
    }
});

// Serve static files from downloads directory
app.use('/downloads', express.static('downloads'));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
    console.log(`Vui lòng cấu hình PHPSESSID trước khi sử dụng`);
});
