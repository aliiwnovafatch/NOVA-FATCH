# NovaFetch Dashboard

Premium glassmorphism frontend for the FastAPI Social Media Downloader API.

## Features
- Responsive layout for phones, tablets and desktops.
- Obsidian, violet and cyan visual theme.
- Supports the backend's `GET /api/extract?url=...` and `GET /api/health` contract.
- Video/audio format tabs, thumbnails, metadata, copy-link and open-link actions.
- Local-only recent history and workspace preferences.
- Loading, validation, API error and connection status states.
- No framework or build step required.

## Run locally
You can serve the static files with any local HTTP server. For example, with Python:
```bash
python -m http.server 8080
```
Open `http://localhost:8080`. You can also host the files on a static hosting provider.

## Connect Railway backend
1. Deploy the FastAPI backend to Railway and generate a public HTTPS domain.
2. Open NovaFetch and choose **Settings**.
3. Enter the base URL only, for example `https://your-service.up.railway.app`. Do not append `/api/extract`.
4. Save connection and test it.
5. In the backend Railway variables, set `CORS_ORIGINS` to the exact frontend origin (scheme + host, no path), e.g. `https://your-dashboard.example`.
6. Ensure the API health endpoint responds at `/api/health`.

The browser cannot call a backend from another origin unless the backend CORS policy allows the frontend origin. Do not set `CORS_ORIGINS=*` for this deployment.

## API contract expected
`GET /api/extract?url=<encoded social media URL>` returns:
- `status`, `platform`, `title`, `uploader`, `duration`, `duration_string`
- `thumbnail`, `download_url`, `views`, `likes`
- `video_formats[]` and `audio_formats[]`, each optionally containing `quality`, `ext`, `filesize`, `url`, and other format details.

`GET /api/health` returns `{"status":"ok", ...}`.

## Privacy and legal use
History and preferences are stored in this browser's localStorage. They are not sent to the backend except the source URL submitted for extraction. Use only media you own or are authorized to access and comply with platform terms and applicable law. The frontend does not bypass private-account restrictions, DRM or access controls.

Direct media links can expire. Some video-only formats do not contain audio. This frontend opens/copies links returned by the API; it does not download, merge, or proxy media files.

## Notes
- Google Fonts are loaded from Google Fonts; a system font fallback is available.
- Browser clipboard access is most reliable on HTTPS or localhost.
- For production, host behind HTTPS and configure backend CORS to the exact frontend origin.
