<img src="./browser/icon.png" width="50" align="left" alt="Testcord">Testcord

[![Release](https://img.shields.io/github/v/release/TestcordDev/TestCord?label=Latest+Release&color=blue)](https://github.com/TestcordDev/TestCord/releases/tag/untagged-5c75afbdfad18f944bcb)
[![Discord](https://img.shields.io/discord/1434211283317690502?color=5865F2&label=Discord&logo=discord&logoColor=white)](https://discord.gg/EMDpkV57gW)
[![CO-Owner](https://img.shields.io/badge/Owner-Mixiruri-ff69b4?logo=github&logoColor=white)](https://github.com/Mixiruri)
[![Owner](https://img.shields.io/badge/Owner-x2b1-red?logo=github&logoColor=white)](https://github.com/x2b1)
[![CO-Owner](https://img.shields.io/badge/Owner-dxrx99-orange?logo=github&logoColor=white)](https://github.com/dxrx99)

Testcord is a fork of [Equicord](https://github.com/Equicord/Equicord) which is a fork of [Vencord](https://github.com/Vendicated/Vencord), with over 750 plugins.

You can join our [Discord server](https://discord.gg/UjAbZCgXtB) for commits, changes, chatting, or even support.

## What makes Testcord different?

- **740+ plugins**, more than any other fork
- **No rules** on which plugins can be added
- You decide what plugins you wanna use, not some admin that might not be comfortable with it (indi reference)
- Less stable, more fun

## Included Plugins

Testcord's included plugins can be found [here](https://Testcord.dev).

## Installing / Uninstalling

**Windows**

- [CLI](https://github.com/TestcordDev/TestCord/releases/download/latest/Windows_Testcord_installer-rel_cli.exe)
- [GUI](https://github.com/TestcordDev/TestCord/releases/download/latest/Windows_Testcord_installer-rel.exe)

**MacOS**

- [GoofCord Guide](GoofCordGuide.md)

**Linux**

- [CLI x11 & Wayland](https://github.com/TestcordDev/TestCord/releases/download/latest/Linux_Testcord_installer-rel_cli)
- [GUI x11 & Wayland](https://github.com/TestcordDev/TestCord/releases/download/latest/Linux_Testcord_installer-rel)
- [Wayland only](https://github.com/TestcordDev/TestCord/releases/download/latest/Linux_Testcord_installer-rel_wayland)
- [x11 only](https://github.com/TestcordDev/TestCord/releases/download/latest/Linux_Testcord_installer-rel_x11)

## Installing Testcord Devbuild — recommended

shell:

```sh
bash -c "$(curl -sS https://raw.githubusercontent.com/TestcordDev/Testcord/refs/heads/main/misc/install.sh)"
```

### Dependencies

[Git](https://git-scm.com/) and [Node.JS LTS](https://nodejs.org/) are required.

Install `pnpm`:

> ❗ This next command may need to be run as admin/root depending on your system, and you may need to close and reopen your terminal for pnpm to be in your PATH.

```sh
npm i -g pnpm
```

> ❗ **IMPORTANT** — Make sure you aren't using an admin/root terminal from here onwards. It will mess up your Discord/Testcord instance, and you will most likely have to reinstall.

Clone Testcord:

```sh
git clone https://github.com/TestcordDev/TestCord
cd TestCord
```

Install dependencies:

```sh
pnpm install --frozen-lockfile
```

Build Testcord:

```sh
pnpm build
```

You can also build dev (additional plugins) (not required):

```sh
pnpm dev
```

Inject Testcord into your desktop client:

```sh
pnpm inject
```

Build Testcord for web:

```sh
pnpm buildWeb
```

After building Testcord's web extension, locate the appropriate ZIP file in the `dist` directory and follow your browser's guide for installing custom extensions, if supported.

> Note: Firefox extension zip requires Firefox for Developers

## Credits

- [Thororen](https://github.com/thororen1234) for creating [Equicord](https://github.com/Equicord/Equicord)
- [Vendicated](https://github.com/Vendicated) for creating [Vencord](https://github.com/Vendicated/Vencord)
- [verticalsync](https://github.com/verticalsync) for [Suncord](https://github.com/verticalsync/Suncord)

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=TestcordDev/testcord&type=Date)](https://www.star-history.com/#TestcordDev/Testcord&type=date&legend=bottom-right)

## Disclaimer

Discord is a trademark of Discord Inc., and solely mentioned for the sake of descriptivity. Mentioning it does not imply any affiliation with or endorsement by Discord Inc. Testcord is not affiliated with Equicord or Vencord.

<details>
<summary>⚠️ Using Testcord, Equicord or Vencord violates Discord's Terms of Service</summary>
    <br>
    <p>Any Discord custom client is against TOS. Though we haven't seen anyone get banned for it yet. Unless you abuse (and by that I mean really abuse) risky plugins like statusRotation/sendtoalldms, etc. If you use these risky plugins with care, you'll be okay.</p>
</details>
