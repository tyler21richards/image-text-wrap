// When the picture sheet on phones and tablets lets taps through to the note. Pure bookkeeping, no DOM: the
// sheet (src/live-preview/toolbar-sheet.ts) runs the timers and passes on the pointer events.
//
// A sheet that has just appeared lets taps through until the second tap of a double tap can no longer come
// (DOUBLE_TAP_WAIT), so that tap reaches the picture it was meant for. But a touch's click is aimed at what is
// under the finger when it lifts, not where it pressed: a second press that began in that time and lifted after
// it would press the button that had appeared under the finger by then. So the sheet keeps letting taps through
// until every press that began in that time has ended, however long it lasts, and its click has gone by.

export class PassThrough {
	private on = false;
	/** The wait for a double tap's second tap is over. */
	private waited = true;
	/** Pointers (by pointerId) whose press began while taps went through, still down. */
	private readonly presses = new Set<number>();
	/** Such a press has lifted, and its click is still to come. */
	private clickDue = false;

	/** Whether taps go through the sheet now. */
	get active(): boolean {
		return this.on;
	}

	/** The sheet has appeared: taps go through it, for now. */
	start(): void {
		this.reset();
		this.on = true;
		this.waited = false;
	}

	/** The sheet is hidden or gone: nothing goes through it any more, and nothing is waited for. */
	stop(): void {
		this.reset();
		this.on = false;
	}

	/** A pointer went down anywhere. */
	press(id: number): void {
		if (this.on) this.presses.add(id);
	}

	/** A pointer went up. True when its press began while taps went through: its click is now to come. */
	lift(id: number): boolean {
		if (!this.presses.delete(id)) return false;
		this.clickDue = true;
		return true;
	}

	/** A pointer's press was taken over (by a scroll) or lost: no click comes for it. */
	cancel(id: number): void {
		this.presses.delete(id);
	}

	/** The click after such a press has gone by, or did not come in time. */
	clicked(): void {
		this.clickDue = false;
	}

	/** The wait for a double tap's second tap is over. */
	waitOver(): void {
		this.waited = true;
	}

	/**
	 * Whether the sheet stops letting taps through now: once the wait is over, no press that began meanwhile is
	 * still down, and no click of one is still to come. True once; `active` is false from then on.
	 */
	settle(): boolean {
		if (!this.on || !this.waited || this.presses.size > 0 || this.clickDue) return false;
		this.on = false;
		return true;
	}

	private reset(): void {
		this.waited = true;
		this.presses.clear();
		this.clickDue = false;
	}
}
