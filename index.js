const fs = require('fs');
const path = require('path');
const axios = require('axios');
const FormData = require('form-data');
require('dotenv').config();

// 設定（.envから取得）
const IMMICH_URL = process.env.IMMICH_URL; // ImmichのAPIエンドポイント
const IMMICH_API_KEY = process.env.IMMICH_API_KEY; // ImmichのAPIキー
const TARGET_FOLDER = process.env.TARGET_FOLDER; // アップロードしたいフォルダのパス

// 画像ファイル拡張子
const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.heic'];

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
async function uploadImage(filePath) {
    const form = new FormData();
    form.append('assetData', fs.createReadStream(filePath), path.basename(filePath));

    try {
        const response = await axios.post(IMMICH_URL, form, {
            headers: {
                ...form.getHeaders(),
                'x-api-key': IMMICH_API_KEY,
            },
            maxContentLength: Infinity,
            maxBodyLength: Infinity,
        });
        console.log(`Uploaded: ${filePath} -> ${response.status}`);
    } catch (err) {
        console.error(`Failed: ${filePath} -> ${err.message}`);
    }
}

// メイン処理
(async () => {
    const files = getAllImageFiles(TARGET_FOLDER);
    console.log(`Found ${files.length} image(s).`);
    for (const file of files) {
        await uploadImage(file);
    }
})();