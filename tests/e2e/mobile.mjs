// Phone and tablet testing on desktop Obsidian: Obsidian's own mobile emulation (app.emulateMobile, which
// switches the whole UI to its phone or tablet layout and reloads the window) plus real touch input sent
// through the Chrome DevTools Protocol (Input.dispatchTouchEvent: the page sees trusted pointer events
// with pointerType "touch" and touch events, and the browser scrolls and long-presses as on a device).
//
// Emulation is stored in the profile, so always call setMobile(page, false) when done.
import { prepareWindow, setWindowSize } from './obsidian.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const SIZES = {
	phone: { width: 390, height: 844 },
	tablet: { width: 1024, height: 768 },
};

async function waitReady(page, mobile) {
	for (let i = 0; i < 150; i++) {
		const ok = await page
			.evaluate((mobile) => !!window.app?.workspace?.layoutReady && window.app.isMobile === mobile, mobile)
			.catch(() => false);
		if (ok) return;
		await sleep(200);
	}
	throw new Error(`Obsidian did not come back ${mobile ? 'in' : 'out of'} mobile emulation`);
}

/**
 * Turns Obsidian's mobile emulation on (size "phone" or "tablet") or off, waiting for the reload.
 * Touch emulation is (re)enabled for the page when turning it on.
 */
export async function setMobile(page, on, size = 'phone') {
	const now = await page.evaluate(() => window.app.isMobile).catch(() => null);
	if (now !== on) {
		await page.evaluate((on) => window.app.emulateMobile(on), on).catch(() => {});
		await sleep(1500);
		await waitReady(page, on);
		await prepareWindow(page);
		await sleep(800);
	}
	if (on) {
		await setWindowSize(page, SIZES[size].width, SIZES[size].height);
		await touch(page).enable();
	} else {
		await touch(page).disable();
		await setWindowSize(page, 1280, 900);
	}
}

/** Real touch input for one page. Coordinates are CSS pixels in the window. */
export function touch(page) {
	let session = page.__itwTouch;
	const get = async () => {
		if (!session) {
			session = await page.context().newCDPSession(page);
			page.__itwTouch = session;
		}
		return session;
	};
	const send = async (method, params) => (await get()).send(method, params);
	const point = (x, y) => [{ x, y, radiusX: 4, radiusY: 4, force: 1, id: 1 }];
	return {
		enable: () => send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 }),
		disable: () => send('Emulation.setTouchEmulationEnabled', { enabled: false }),
		down: (x, y) => send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: point(x, y) }),
		move: (x, y) => send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: point(x, y) }),
		up: () => send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }),
		cancel: () => send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] }),
		async tap(x, y) {
			await this.down(x, y);
			await sleep(60);
			await this.up();
		},
		/** Press and hold without moving, then optionally release. */
		async longPress(x, y, ms = 700, release = true) {
			await this.down(x, y);
			await sleep(ms);
			if (release) await this.up();
		},
		/** Moves the finger from (x0,y0) to (x1,y1) in `steps` steps, `stepMs` apart. Does not press or release. */
		async moveTo(x0, y0, x1, y1, steps = 12, stepMs = 16) {
			for (let i = 1; i <= steps; i++) {
				await this.move(x0 + ((x1 - x0) * i) / steps, y0 + ((y1 - y0) * i) / steps);
				await sleep(stepMs);
			}
		},
		/** A quick swipe (scroll gesture): press, move, release, with no pause before moving. */
		async swipe(x0, y0, x1, y1, steps = 10, stepMs = 16) {
			await this.down(x0, y0);
			await this.moveTo(x0, y0, x1, y1, steps, stepMs);
			await this.up();
		},
	};
}
