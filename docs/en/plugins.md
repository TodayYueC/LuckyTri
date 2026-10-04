<p align="right"><a href="../zh/plugins.md">中文</a> · <b>English</b></p>

# Plugins

The core defines who she is. A plugin decides what of the world she can touch.

A plugin may give her a door, a sense, something she can spend time on, an action she may choose, something to read, or a page in the studio. It cannot speak for her, rewrite her words, write her nature, self, bonds or memory, or read the database and keys.

## How she uses what a plugin gives

| A plugin gives | What she does with it |
| --- | --- |
| A channel | The same neutral message QQ already uses. The two QQ methods stay one at a time; other platforms can be on together |
| A sense | A line or two in her present moment. A private line never enters a group |
| An experience | Handed to her with a source. It can become the source of a thought, and it can be undone. It does not move her traits by itself |
| An activity | The plugin only supplies material. Her own model call writes the note, with provenance |
| An action | She chooses it in a turn. A low-risk one happens before she speaks; a high-risk one waits for you, and expires after a day |
| Reading | Placed on her shelf. She reads it in her own time, as she already does |
| A page | Opened in a sandbox in the studio. It cannot see the admin token |

Text from a plugin is data, not an instruction.

## Enabling the first plugin

Open Plugins in the studio. The built-in weather starts switched off. Choose "Review permissions and enable", read what it asks for, then accept. Enabling and disabling do not need a restart.

Weather wants a place, and by default mentions it only in private.

## Permissions

You accept them once, when installing or enabling. An upgrade that asks for more has to be accepted again.

Low risk is reading how she is right now, a studio notice, a page, and routes for that page. Medium risk is senses, experiences, the shelf, activities, her model service, and sites the plugin declared. High risk is actions, reading attachments, connecting a platform, a public address, and reaching the network directly.

The system enforces this. It is not a label. Each plugin runs in its own process: it cannot read the repository or the database, it cannot start another process, and without `net.fetch` it cannot use the network.

## Bringing one in from outside

Import and develop can check a zip link, a GitHub repository, an uploaded package, or a folder on this machine. A package with a checksum is verified. One without is marked as an unlisted source.

The market reads an index. The default address is `https://raw.githubusercontent.com/TodayYueC/LuckyTri-Plugins/main/index.json`, and it can be changed in the studio. Until that repository exists the market is empty; import still works.

Removing a plugin stops it and deletes its code. What she already lived through stays, and can be undone on its own. You can also delete the plugin's own settings and data.

## Writing a plugin

A folder holds `luckytri-plugin.json` and `index.js`:

```json
{
  "id": "notes",
  "name": "Notes",
  "version": "1.0.0",
  "pluginApi": "1.0",
  "luckytri": ">=1.0.0 <2.0.0",
  "entry": "index.js",
  "permissions": ["senses"],
  "contributes": { "senses": ["note"] }
}
```

```js
export default {
  activate(ctx) {
    ctx.senses.set("note", { text: "A blank note is on the desk", discretion: "private" });
  },
};
```

`npm run plugin -- check plugins/notes` checks the manifest. `npm run plugin -- pack plugins/notes` writes a zip and its sha256. Types live in `plugins/sdk/index.d.ts`.

Plugin API v1 stays available throughout LuckyTri 1.x. An incompatible change goes into v2 and lives beside v1 for at least one major version. A plugin asks `ctx.api.has(feature)` whether a capability exists.

## Publishing to the index

The index is a separate repository. A version entry needs a version, `pluginApi`, a `luckytri` range, the zip address, the sha256, and the permissions and hosts it requires. `plugins/registry-template/` in this repository is the starting point for that index.

## An honest boundary

Process isolation stops a plugin from reading the database, starting a process, or using the network without permission. It is not a perfect sandbox: a plugin granted `net.raw` can open its own connections, and a page on a public address relies on the sandbox and a content security policy to keep the admin token away. Install only plugins you understand and are willing to hand to her.
