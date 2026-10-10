# Image Text Wrap

Word-style text wrapping for images in [Obsidian](https://obsidian.md).

- Click a picture and a small toolbar appears above it.
- One click turns text wrapping on or off and picks the side.
- Drag the picture to another place in the note, and the text flows around it wherever it lands.
- Wrapped pictures look the same in Live Preview, Reading view and exported PDFs.

You never have to type any syntax. The plugin stores your choice inside the image link, so the note stays plain Markdown.

## Using it

### The picture toolbar

Click an image in Live Preview. A toolbar appears just above it (or below it, when there is no room above):

| Button | What it does |
|---|---|
| **In line with text** | No wrapping. This is how Obsidian shows images normally. |
| **Wrap text left** | The image sits on the left, and text flows down its right side. |
| **Wrap text right** | The image sits on the right, and text flows down its left side. |
| **Top and bottom** | The image is centred on its own row, with text above and below only. |
| **Spacing** | The space between the image and the text: None, Small, Medium or Large. |

Click the highlighted wrap button again to turn wrapping off. Every change is one undo step (<kbd>Ctrl/Cmd</kbd>+<kbd>Z</kbd>).

The toolbar never covers Obsidian's own image controls. You can still resize an image by dragging its corner, zoom it, and open it in the image viewer.

### Moving an image

Press on an image and drag it. A copy follows the pointer, and a line shows where the image will land: at the start of a paragraph, heading, list, quote, table or code block, or at the end of the note.

- If the image wraps text, drop it on the left or right half of the note to choose its side. The text from that block onwards flows around it.
- If the image does not wrap text, it moves there as an ordinary image.
- Move near the top or bottom edge to scroll. Press <kbd>Esc</kbd> to cancel.

### Other ways to choose a layout

The same choices are in the right-click menu of an image (in Live Preview and Reading view) and in the command palette (search for "image").

## Settings

| Setting | Default | What it does |
|---|---|---|
| Show the picture toolbar | On | Show the toolbar when you click an image. |
| Move images by dragging | On | Drag images to move them. Turn this off to use Obsidian's own image dragging. |
| Default spacing | Medium (16 px) | The spacing an image gets when you first turn on wrapping for it. |
| Widest wrapped image | 50% | A wrapped image is shown no wider than this share of the note column. Its stored size is not changed. |

## How the layout is stored

The layout is written into the image link, between the file name and the size:

```markdown
![[photo.png|wrap-left|300]]
![[photo.png|A caption|wrap-right|gap-24|300]]
![A caption|wrap-block|300](photo.png)
```

| Word | Meaning |
|---|---|
| (none) | In line with text |
| `wrap-left`, `wrap-right` | Wrap text on that side |
| `wrap-block` | Top and bottom |
| `gap-0`, `gap-8`, `gap-16`, `gap-24` | Spacing in pixels. Medium (16) is the default and is not written. |

The size stays last, so Obsidian keeps applying it. If you remove the plugin, your images go back to normal images at the size you gave them.

## Known limits

- Images inside tables, callouts, quotes, lists and headings, and images in embedded notes, are shown but cannot be changed with the toolbar or moved by dragging.
- A dragged image lands at the start of a block, not in the middle of a paragraph, because a note is one stream of text.
- Live Preview shows a blank line as slightly taller than the paragraph spacing in Reading view, so the text beside a tall image can break at a slightly different word.
- PDF export uses Arial unless you set a text font in Obsidian's Appearance settings, so line breaks may differ from the screen.
- Desktop only for now. Phone and tablet support is planned.

## Installing

Until the plugin is in Obsidian's community directory:

1. Download `main.js`, `manifest.json` and `styles.css` from the [latest release](https://github.com/tyler21richards/image-text-wrap/releases).
2. Put them in `<your vault>/.obsidian/plugins/image-text-wrap/`.
3. In Obsidian, open **Settings → Community plugins**, and turn on **Image Text Wrap**.

## Development

```bash
npm install
npm run build      # type-check and bundle main.js
npm test           # unit tests (node:test)
npm run lint
```

`tests/e2e/` holds a harness that drives a real Obsidian over the Chrome DevTools Protocol, with real pointer events. Set `OBSIDIAN_APP` to an Obsidian.app and run `node scripts/obsidian.mjs launch --fresh`; see the top of `scripts/obsidian.mjs` for the commands. `test-vault/Fixture.md` covers every case in the acceptance tests.

## Credits

Parts of this plugin are adapted from these MIT-licensed plugins. Their notices are in [LICENSE](LICENSE).

- [Adjustable Media](https://github.com/Yi-luo-hua/obsidian-adjustable-media) by Yi-luo-hua: pointer gesture handling, undo scroll fix, float fixes for Live Preview and Reading view.
- [Image Kit](https://github.com/haivri/obsidian-image-kit) by Robert Fleming: in-link layout grammar and toolbar patterns.
- [Image Rows and Wraps](https://github.com/Black-Manthor/image-rows-and-wraps) by Black-Manthor: gesture and PDF testing techniques.

## License

[MIT](LICENSE)
