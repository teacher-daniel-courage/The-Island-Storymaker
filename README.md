# Path.er

A prototype tool for building choose-your-path games: each scene has a GIF, a title, some text and up to four options (A–D), and each option leads to another scene.

## Open it

Double-click `index.html`. It runs in the browser with no install or server. The home page has two ways in:

- **Make a story** opens the Storymaker (`storymaker.html`). It comes loaded with *The Cast Away*, the original game from theisland.framer.website.
- **Play a story** opens the player (`play.html`). Choose or drop a story file exported from the Storymaker, or play *The Cast Away*. The open story is kept if you reload the page. **Open another story** goes back to the file picker.

Both pages have **← Back to start** at the top left, which returns to the home page.

## How it works

- **Scenes** (left): every scene in story order. Red dot = death, green = happy ending.
- **Scene tab**: edit the title, type, background color, GIF link (or upload) and text, and pick where each option leads. Choosing “New scene…” in a dropdown creates the next scene for you. The live preview on the right updates as you type.
- **Colors**: options are always A coral, B ocean blue, C palm green, D orchid. Scenes are white unless you pick a background (a swatch, or any color with the rainbow one); death scenes are black. Text turns white on dark backgrounds.
- **Map tab**: the whole story from top to bottom, one row per step. Click any scene to edit it. The **+** on a scene’s corner adds an option that leads to a new scene (it fills an unconnected option first, and disappears once a scene has all four). Point at a scene to show its bin button and delete it.
- **Deleting a scene** (bin on the map, or **Delete scene** in the Scene tab): blank options that led to it are removed too; options you’d written text for stay, marked as leading nowhere. Scenes after it aren’t deleted; they move to “Not connected”. **Undo** brings everything back.
- **To fix** (top bar): options that lead nowhere, scenes nothing leads to, missing text, and whether a happy ending can be reached.
- **Lives**: players start with 2 by default. A death scene costs one. With lives left, players return to the scene where they made the fatal choice. With none left, it’s game over and they start again. Press − below 1 to turn lives **Off**: no hearts are shown, and dying always sends players back to choose again (saved as `"lives": 0` in the story file).
- **Play / Play from here**: try the game exactly as players will see it.

Your work saves in this browser automatically. Use **File → Export story file** to keep a copy or send it to someone, and **Import** to open one.

## Vocabulary review

A separate tool for the classroom (`vocab.html`, linked from the home page under the two cards).

- **Word lists**: one per class. Each word has the word itself, its meaning, a picture and, if you like, your own recording of it.
- **Meanings**: type one, or click **Look up meaning** to get up to 8 dictionary meanings to choose from (one from each sense first, so “bank” offers both the money and the river meanings). The chosen meaning can be edited, and its word type (noun, verb…) shows as a tag you can remove. Meanings come from Wiktionary, with the Free Dictionary API (dictionaryapi.dev) as a backup, so looking one up needs the internet; reviewing doesn't. Add a picture with **Add picture**, by dragging an image onto the word, or by copying an image (right-click → **Copy image**), clicking the word and pressing Ctrl+V. Big photos are scaled down to 1600 px so lists stay small. **Enter** in a word box moves to the next word, adding one at the end.
- **Sound**: **Computer voice** reads the word with the browser's English voice. **Record my voice** records up to 10 seconds; once a word has a recording, the review plays that instead of the computer voice.
- **Review**: choose how the words come up (a picture, the written word, its sound, or a random mix), whether to shuffle, and whether to say the word when the answer is shown. **Show answer** reveals the word, its word type and meaning, and its picture. The review fills the screen: **Space** shows the answer, then goes to the next word; **←** goes back; **S** plays the sound again; **F** is full screen; **Esc** closes. Words without a picture never come up as a picture, and a word with neither a picture nor a meaning doesn't come up as the written word (its answer would just repeat it).
- **Saving**: lists are kept in this browser (IndexedDB, because pictures and recordings are too big for localStorage). They belong to the browser *and* the address, so lists made on the live site don't show up in a local preview and vice versa. **Export** saves a list as one `.vocab.json` file, pictures and recordings included; **Open a list file** on the lists page (or dropping the file there) brings it back on any computer.

## Files

- `index.html`, `css/site.css`: the home page
- `about.html`: the About page (opened with the **About** button, top right of the home page). Its text goes where the comment in the file says, replacing the placeholder.
- `storymaker.html`, `js/storymaker.js`, `css/storymaker.css`: the editor
- `play.html`, `js/play.js`: the play page, which opens a story file (also styled by `css/site.css`)
- `favicon.svg`: the tab icon (the Storymaker mark)
- `js/player.js`, `css/player.css`: the game itself (the scene box) and the story-file checks, shared by the Storymaker preview and the play page
- `js/sample-story.js`: The Cast Away
- `vocab.html`, `js/vocab.js`, `css/vocab.css`: Vocabulary review
