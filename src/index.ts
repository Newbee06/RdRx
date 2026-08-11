import cronDelete from './helpers/cronDelete';
import { initializeTables } from './database';
import { router } from './routes';
import { Env } from './types';

/**
 * Get the content type for a file based on its extension.
 */
function getContentType(path: string): string {
	const extension = path.split('.').pop()?.toLowerCase();

	const contentTypes: Record<string, string> = {
		html: 'text/html; charset=utf-8',
		htm: 'text/html; charset=utf-8',
		css: 'text/css; charset=utf-8',
		js: 'application/javascript; charset=utf-8',
		mjs: 'application/javascript; charset=utf-8',
		json: 'application/json; charset=utf-8',
		txt: 'text/plain; charset=utf-8',
		xml: 'application/xml; charset=utf-8',

		jpg: 'image/jpeg',
		jpeg: 'image/jpeg',
		png: 'image/png',
		gif: 'image/gif',
		webp: 'image/webp',
		svg: 'image/svg+xml',
		ico: 'image/x-icon',
		avif: 'image/avif',

		pdf: 'application/pdf',
		zip: 'application/zip',
		gz: 'application/gzip',
		7z: 'application/x-7z-compressed',

		mp3: 'audio/mpeg',
		wav: 'audio/wav',
		ogg: 'audio/ogg',
		mp4: 'video/mp4',
		webm: 'video/webm',
		mov: 'video/quicktime',

		doc: 'application/msword',
		docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
		xls: 'application/vnd.ms-excel',
		xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
		ppt: 'application/vnd.ms-powerpoint',
		pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
	};

	return contentTypes[extension || ''] || 'application/octet-stream';
}

/**
 * Handle files stored in Cloudflare R2.
 *
 * URL format:
 *   /files/uploads/example.jpg
 *
 * R2 key:
 *   uploads/example.jpg
 */
async function handleFileRequest(request: Request, env: Env): Promise<Response> {
	const url = new URL(request.url);

	// Remove /files/ from the beginning.
	const key = decodeURIComponent(url.pathname.slice('/files/'.length));

	if (!key) {
		return new Response('File path is required', {
			status: 400,
		});
	}

	try {
		const object = await env.R2_RDRX.get(key);

		if (!object) {
			return new Response('File Not Found', {
				status: 404,
			});
		}

		const headers = new Headers();

		// Preserve useful R2 metadata.
		object.writeHttpMetadata(headers);

		// Make sure the browser knows the correct file type.
		if (!headers.get('Content-Type')) {
			headers.set('Content-Type', getContentType(key));
		}

		if (object.httpEtag) {
			headers.set('ETag', object.httpEtag);
		}

		// Allow browser caching for files.
		headers.set('Cache-Control', 'public, max-age=31536000, immutable');

		// HEAD request only returns headers.
		if (request.method === 'HEAD') {
			return new Response(null, {
				status: 200,
				headers,
			});
		}

		return new Response(object.body, {
			status: 200,
			headers,
		});
	} catch (error) {
		console.error('R2 file read error:', error);

		return new Response('Internal Server Error', {
			status: 500,
		});
	}
}

export default {
	async scheduled(controller: any, env: Env, ctx: any) {
		await cronDelete(env);
	},

	async fetch(request: Request, env: Env, ctx: any) {
		const url = new URL(request.url);

		/*
		 * /files/*
		 *
		 * Files are stored in the R2 bucket "rdrx".
		 *
		 * Example:
		 *   https://okx.run/files/uploads/photo.jpg
		 *
		 * becomes:
		 *   R2 key = uploads/photo.jpg
		 */
		if (
			url.pathname.startsWith('/files/') &&
			(request.method === 'GET' || request.method === 'HEAD')
		) {
			return handleFileRequest(request, env);
		}

		// Initialize database tables once at startup.
		ctx.waitUntil(
			initializeTables(env).catch((error) => {
				console.error('Failed to initialize database tables:', error);
			}),
		);

		// All other requests continue through the existing router.
		return router(request, env);
	},
};
