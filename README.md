# TikTok HQ Upload Web Application

A web-based implementation of the TikTok HQ Upload functionality featuring the FISH (Cutefish FISH Architecture Engine) method and Direct Pass-Through mode for 100% lossless video processing.

## Features

- **FISH Method**: Pure lossless MP4 atom restructuring for TikTok compatibility
- **Direct Pass-Through**: 100% quality preservation - no video/audio re-encoding
- **Client-Side Processing**: Fast processing in your browser (simulated in this demo)
- **Secure & Private**: Your videos never leave your device in the actual implementation
- **Support for Multiple Formats**: MP4, MOV, WebM, and more

## Core Engine Explanation

The TikTok HQ Upload core engine consists of:

### 1. FISH Method (Cutefish FISH Architecture Engine)
A pure JavaScript implementation that manipulates MP4 atoms in-memory to make videos compatible with TikTok's upload system without re-encoding. The FISH method applies:

- **V1 64-bit Infinite Duration Sentinel**: Modifies mvhd timescale to 48000 and sets duration to 0xFFFFFFFFFFFFFFFF
- **Proportional Rescaling**: Adjusts tkhd and elst for video/audio tracks from original timescale to 48000 clock
- **Zero-Offset CTTS Table Injection**: Ensures PTS consistency and triggers pass-through mode
- **In-track Video Anchor Sample**: Adds stts delta=0, stsz=8, stsc+stco inside mdat
- **Micro-Shield Stream Trap**: Places 16-byte dummy sample on Track 3 right after mdat
- **Pure Binary Atom Manipulation**: 0% compression, 0% quality loss, ~0.05s execution

### 2. Direct Pass-Through Mode
The FISH method with compression disabled, providing:
- 100% lossless MP4 atom restructuring
- Only ~24 bytes overhead added to the file
- Preserves original resolution, video quality, and audio quality
- No re-encoding of video or audio streams

### 3. Processing Pipeline
In the full implementation, the pipeline includes:
1. File input handling
2. Optional compression (FFmpeg WASM-based H.264/H.265)
3. FISH method application (Direct Pass-Through when compression=off)
4. Normalization (FPS adjustment >60fps to 60fps slowmo)
5. Faststart remuxing (moov atom moved to beginning)
6. Final output generation

## Installation

1. Clone or copy this repository to your local machine
2. Navigate to the project directory:
   ```bash
   cd "C:\Users\KP\Desktop\New folder"
   ```
3. Install dependencies:
   ```bash
   npm install
   ```
4. Start the development server:
   ```bash
   npm run dev
   ```
   Or for production:
   ```bash
   npm start
   ```

## Usage

1. Open your browser and go to `http://localhost:3000`
2. Drag and drop a video file onto the upload area, or click to select a file
3. Supported formats: MP4, MOV, WebM, AVI, MKV, etc.
4. Wait for processing to complete (simulated in this demo)
5. Download the processed video with "_tiktok_hq" suffix in the filename

## Project Structure

```
tiktok-hq-upload-web/
├── public/                 # Frontend assets
│   └── index.html          # Main HTML file
├── src/                    # Source code
│   └── fish.js             # Core FISH method implementation
├── uploads/                # Temporary uploaded files (server)
├── processed/              # Processed output files (server)
├── server.js               # Backend Express server
├── package.json            # Project dependencies and scripts
└── README.md               # This file
```

## API Endpoints

The backend provides these API endpoints:

- `GET /` - Serves the main HTML page
- `POST /api/process-video` - Handles video upload and processing
- `GET /api/download/:filename` - Downloads processed videos
- `GET /api/health` - Health check endpoint

## Implementation Notes

This web application provides a simplified demonstration of the TikTok HQ Upload functionality. The actual FISH method implementation is included in `src/fish.js` and is designed to work in both browser and Node.js environments.

For a production implementation that actually processes videos:
1. The FISH method would be called directly in the browser for client-side processing
2. Or sent to a backend service that uses FFmpeg/WASM for more complex operations
3. The Direct Pass-Through mode ensures that when no compression is applied, the video undergoes only MP4 atom restructuring with zero quality loss

## Browser Compatibility

The application works in modern browsers that support:
- ES6+ JavaScript
- File API
- Blob and URL.createObjectURL
- Drag and drop API

## License

MIT License - feel free to modify and extend this implementation for your needs.

## Credits

Based on the original TikTok HQ Upload functionality featuring the FISH (Cutefish FISH Architecture Engine) method.