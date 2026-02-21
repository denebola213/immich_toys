const fs = require('fs');
const path = require('path');
const axios = require('axios');
const FormData = require('form-data');
require('dotenv').config();

// 設定（.envから取得）
const IMMICH_BASE_URL = process.env.IMMICH_BASE_URL; // ImmichのAPIエンドポイント
const IMMICH_API_KEY = process.env.IMMICH_API_KEY; // ImmichのAPIキー

// コマンドライン引数からTARGET_FOLDERを取得
const TARGET_FOLDER = process.argv[2];
if (!TARGET_FOLDER) {
    console.error('Usage: node index.js <TARGET_FOLDER>');
    process.exit(1);
}

// 画像・動画ファイル拡張子
const IMAGE_EXTENSIONS = [
    // 画像
    '.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.heic',
    // キヤノンRAW
    '.cr2', '.cr3', '.crw',
    // 科学用途画像
    '.fit', '.fits', '.fts', '.dcm', '.nii', '.nii.gz', '.tif', '.tiff',
    // 動画
    '.mp4', '.mov', '.avi', '.mkv', '.webm', '.wmv', '.flv', '.m4v', '.3gp', '.mts', '.ts', '.m2ts', '.mpeg', '.mpg'
];

// フォルダ以下の全画像ファイルを再帰的に取得
function getAllImageFiles(dir) {
    let results = [];
    const list = fs.readdirSync(dir);
    list.forEach(file => {
        const filePath = path.join(dir, file);
        const stat = fs.statSync(filePath);
        if (stat && stat.isDirectory()) {
            results = results.concat(getAllImageFiles(filePath));
        } else {
            if (IMAGE_EXTENSIONS.includes(path.extname(file).toLowerCase())) {
                results.push(filePath);
            }
        }
    });
    return results;
}


// 画像をImmichにアップロード
async function uploadImage(filePath, msg) {
    const form = new FormData();
    form.append('assetData', fs.createReadStream(filePath), path.basename(filePath));
    form.append('deviceAssetId', `${filePath}-${fs.statSync(filePath).mtimeMs}`);
    form.append('deviceId', 'immich_toys');
    form.append('fileCreatedAt', (new Date(fs.statSync(filePath).birthtimeMs)).toISOString());
    form.append('fileModifiedAt', (new Date(fs.statSync(filePath).mtimeMs)).toISOString());
    form.append('isFavorite', 'false');

    try {
        const response = await axios.post(`${IMMICH_BASE_URL}/assets`, form, {
            headers: {
                ...form.getHeaders(),
                'x-api-key': IMMICH_API_KEY,
            },
            maxContentLength: Infinity,
            maxBodyLength: Infinity,
        });
        console.log(`Uploaded: ${filePath} -> ${response.status}  : ${msg}`);
    } catch (err) {
        console.error(`Failed: ${filePath} -> ${err.message}  : ${msg}`);
    }
}

// メイン処理
(async () => {
    const files = getAllImageFiles(TARGET_FOLDER);
    let count = 0;
    console.log(`Found ${files.length} image(s).`);
    for (const file of files) {
        count++;
        await uploadImage(file, `${count}/${files.length}`);
    }
})();