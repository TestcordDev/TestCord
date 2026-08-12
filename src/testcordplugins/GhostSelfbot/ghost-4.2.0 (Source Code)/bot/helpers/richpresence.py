import discord

from utils import Config

cfg = Config()
rpc = cfg.get_rich_presence()

# Cheers Nes for the method!
async def get_external_asset(bot, asset_url):
    if not asset_url or asset_url == "":
        return None
    if not asset_url.startswith("https://"):
        return asset_url
    assets = await bot.http.request(discord.http.Route("POST", f"/applications/{rpc.client_id}/external-assets"), json={"urls": [asset_url]})
    for asset in assets:
        return f"mp:{str(asset['external_asset_path'])}"
    
def parse_external_asset(asset_url):
    if asset_url.startswith("mp:"):
        return "https://" + asset_url.split("/https/")[1]
    
    return asset_url if asset_url else None

def generate_activity_json(external_assets):
    activity_json = {
        "name": rpc.name,
        "type": 0,  # ActivityType.playing
        "application_id": rpc.client_id,  # Default client ID for Ghost
        "state": rpc.state,
        "state_url": rpc.state_url,
        "details": rpc.details,
        "details_url": rpc.details_url,
        "assets": {
            "large_image": external_assets["large_image"],
            "large_text": rpc.large_text,
            "large_url": rpc.large_url,
            "small_image": external_assets["small_image"],
            "small_text": rpc.small_text,
            "small_url": rpc.small_url
        }
    }
    
    # loop through each key in activity, if its value is empty, set it to None
    for key, value in activity_json.items():
        if isinstance(value, str) and not value:
            activity_json[key] = None
        elif isinstance(value, dict):
            for sub_key, sub_value in value.items():
                if isinstance(sub_value, str) and not sub_value:
                    value[sub_key] = None
                    
    return activity_json