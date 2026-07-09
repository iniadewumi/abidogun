#!/usr/bin/env node
/**
 * Downloads the Kokoro ONNX weights we self-host under dist/models/.
 * Run before deploy so readers fetch the model from our site (then Cache API),
 * not from Hugging Face on every first visit.
 *
 * Only the q8 quantized weights + the af_heart voice are included (~93MB)
 * to keep GitHub Pages / S3 deploys practical.
 */
import { createWriteStream, existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const MODEL_ID = 'Kokoro-82M-v1.0-ONNX';
const OUT_DIR = join(ROOT, 'dist', 'models', MODEL_ID);
const HF_BASE = `https://huggingface.co/onnx-community/${MODEL_ID}/resolve/main`;

const FILES = [
    { path: 'config.json', required: true },
    { path: 'tokenizer.json', required: true },
    { path: 'tokenizer_config.json', required: true },
    // dtype: "q8" → model_quantized.onnx (~92MB)
    { path: 'onnx/model_quantized.onnx', required: true },
    // Voice used by the reader
    { path: 'voices/af_heart.bin', required: true },
];

function formatBytes(n) {
    if (n < 1024) return `${n} B`;
    if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
    if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
    return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

async function downloadFile(relPath) {
    const dest = join(OUT_DIR, relPath);
    mkdirSync(dirname(dest), { recursive: true });

    if (existsSync(dest) && statSync(dest).size > 0) {
        console.log(`  skip  ${relPath} (${formatBytes(statSync(dest).size)} already present)`);
        return;
    }

    const url = `${HF_BASE}/${relPath}`;
    console.log(`  get   ${relPath}`);
    const res = await fetch(url, { redirect: 'follow' });
    if (!res.ok) {
        throw new Error(`Failed to download ${relPath}: HTTP ${res.status}`);
    }

    const total = Number(res.headers.get('content-length') || 0);
    let received = 0;
    let lastPct = -1;

    const nodeStream = Readable.fromWeb(res.body);
    nodeStream.on('data', (chunk) => {
        received += chunk.length;
        if (!total) return;
        const pct = Math.floor((received / total) * 100);
        if (pct !== lastPct && pct % 5 === 0) {
            lastPct = pct;
            process.stdout.write(`\r  …    ${relPath} ${pct}% (${formatBytes(received)}/${formatBytes(total)})`);
        }
    });

    await pipeline(nodeStream, createWriteStream(dest));
    if (total) process.stdout.write('\n');
    console.log(`  done  ${relPath} (${formatBytes(statSync(dest).size)})`);
}

async function main() {
    console.log(`Downloading Kokoro model into ${OUT_DIR}`);
    mkdirSync(OUT_DIR, { recursive: true });

    for (const file of FILES) {
        try {
            await downloadFile(file.path);
        } catch (err) {
            if (file.required) throw err;
            console.warn(`  warn  optional file skipped: ${file.path} (${err.message})`);
        }
    }

    console.log('Kokoro model ready for self-hosting.');
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
