from discord.ext import commands
from utils import config
from utils import webhook as webhook_client
from utils import console
import bot.helpers.cmdhelper as cmdhelper
import requests, json

class Sniper(commands.Cog):
    def __init__(self, bot, controller):
        self.bot = bot
        self.controller = controller
        self.description = cmdhelper.cog_desc("sniper", "Sniper commands")
        self.cfg = config.Config()

    @commands.command(name="sniper", description="Sniper commands.", usage="")
    async def sniper(self, ctx, selected_page: int = 1):
        cfg = self.cfg
        pages = cmdhelper.generate_help_pages(self.bot, "Sniper")

        await cmdhelper.send_message(ctx, {
            "title": f"🔫 sniper commands",
            "description": pages[cfg.get("message_settings")["style"]][selected_page - 1 if selected_page - 1 < len(pages[cfg.get("message_settings")["style"]]) else 0],
            "footer": f"Page {selected_page}/{len(pages[cfg.get('message_settings')['style']])}",
            "codeblock_desc": pages["codeblock"][selected_page - 1 if selected_page - 1 < len(pages["codeblock"]) else 0]
        }, extra_title=f"Page {selected_page}/{len(pages['codeblock'])}")

    @commands.command(name="snipers", description="List all snipers.", usage="")
    async def snipers(self, ctx):
        cfg = self.cfg
        snipers = cfg.get_snipers()
        snipers_str = "\n".join([f"- {sniper.name.capitalize()}: {'Enabled' if sniper.enabled else 'Disabled'}" for sniper in snipers])

        await cmdhelper.send_message(ctx, {
            "title": "Snipers",
            "description": snipers_str
        })

    @commands.command(name="sniperstatus", description="Check the status of a sniper.", usage="[sniper]")
    async def sniperstatus(self, ctx, sniper_str: str = None):
        cfg = self.cfg
        sniper = cfg.get_sniper(sniper_str.lower())

        if sniper is None:
            return await cmdhelper.send_message(ctx, {
                "title": "Error",
                "description": "Please provide a sniper to check the status.",
                "colour": "#ff0000"
            })

        await cmdhelper.send_message(ctx, {
            "title": f"{sniper.name.capitalize()} Sniper",
            "description": f"{sniper.name.capitalize()} Sniper is currently {'enabled' if sniper.enabled else 'disabled'}\nIgnore invalid codes: {sniper.ignore_invalid}",
            "colour": "#00ff00" if sniper.enabled else "#ff0000"
        })

    @commands.command(name="ignoreinvalidcodes", description="Toggle ignoring invalid codes for a sniper.", usage="[sniper]", aliases=["sniperignore", "ignoreinvalid"])
    async def ignoreinvalidcodes(self, ctx, sniper_str: str = None):
        cfg = self.cfg
        sniper = cfg.get_sniper(sniper_str.lower())

        if sniper is None:
            return await cmdhelper.send_message(ctx, {
                "title": "Error",
                "description": "Please provide a sniper to toggle ignoring invalid codes for.",
                "colour": "#ff0000"
            })
        
        sniper.toggle_ignore_invalid()
        ignore_state = sniper.ignore_invalid

        await cmdhelper.send_message(ctx, {
            "title": f"{sniper.name.capitalize()} Sniper",
            "description": f"{sniper.name.capitalize()} Sniper will now be {'ignoring' if not ignore_state else 'checking'} invalid codes."
        })

    @commands.command(name="nitrosniper", description="Toggle the Nitro sniper.", usage="[on/off]")
    async def nitrosniper(self, ctx, state: str = None):
        cfg = self.cfg
        sniper = cfg.get_sniper("nitro")
        sniper_state = sniper.enabled
        
        if state is None:
            if sniper.enabled:
                sniper.disable()
                sniper_state = False
            else:
                sniper.enable()
                sniper_state = True

            state = "on" if sniper_state else "off"

        else:
            if state.lower() not in ["on", "off"]:
                return await cmdhelper.send_message(ctx, {
                    "title": "Error",
                    "description": "Invalid state, please use `on` or `off`.",
                    "colour": "#ff0000"
                })

            if state.lower() == "on":
                sniper.enable()

            elif state.lower() == "off":
                sniper.disable()

            else:
                return await cmdhelper.send_message(ctx, {
                    "title": "Error",
                    "description": "Invalid state, please use `on` or `off`.",
                    "colour": "#ff0000"
                })

        await cmdhelper.send_message(ctx, {
            "title": "Nitro Sniper",
            "description": f"Nitro sniper has been turned {state}",
            "colour": "#00ff00" if sniper_state else "#ff0000"
        })

    @commands.command(name="privnotesniper", description="Toggle the Privnote sniper.", usage="[on/off]")
    async def privnotesniper(self, ctx, state: str = None):
        cfg = self.cfg
        sniper = cfg.get_sniper("privnote")
        sniper_state = sniper.enabled
        
        if state is None:
            if sniper.enabled:
                sniper.disable()
                sniper_state = False
            else:
                sniper.enable()
                sniper_state = True

            state = "on" if sniper_state else "off"

        else:
            if state.lower() not in ["on", "off"]:
                return await cmdhelper.send_message(ctx, {
                    "title": "Error",
                    "description": "Invalid state, please use `on` or `off`.",
                    "colour": "#ff0000"
                })

            if state.lower() == "on":
                sniper.enable()

            elif state.lower() == "off":
                sniper.disable()

            else:
                return await cmdhelper.send_message(ctx, {
                    "title": "Error",
                    "description": "Invalid state, please use `on` or `off`.",
                    "colour": "#ff0000"
                })

        await cmdhelper.send_message(ctx, {
            "title": "Privnote Sniper",
            "description": f"Privnote sniper has been turned {state}",
            "colour": "#00ff00" if sniper_state else "#ff0000"
        })

    @commands.command(name="webhooksetup", description="Setup webhooks for all snipers.", usage="", aliases=["setupwebhooks"])
    async def webhooksetup(self, ctx):
        await self.controller.setup_webhooks(checks=False)
        
        await cmdhelper.send_message(ctx, {
            "title": "Webhook Setup",
            "description": "Successfully setup webhooks for all snipers.",
            "colour": "#00ff00"
        })

def setup(bot):
    bot.add_cog(Sniper(bot))