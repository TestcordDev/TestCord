import uuid
from discord.gateway import DiscordWebSocket

properties = {
    "mobile": ["iOS", "Discord iOS", "iOS"],
    "desktop": ["Windows", "Discord Client", "Windows"],
    "web": ["Windows", "Chrome", "Windows"],
    "embedded": ["Xbox", "Discord Embedded", "Xbox"],
}

original_method = None
os = "mobile"

async def new_method(self):
    global original_method

    print(f"[Session Spoof] new_method called. Original: {original_method}, Current: {DiscordWebSocket.identify}")

    if original_method is None:
        print("[Session Spoof] ERROR: original_method is None. Cannot proceed!")
        return  # Prevent further execution if original is missing

    if DiscordWebSocket.identify is new_method:
        print("[Session Spoof] Preventing infinite recursion!")
        return await original_method(self)  # Execute the original method

    if os.lower() == "mobile":
        self._super_properties = {
            'os': 'Android',
            'browser': 'Discord Android',
            'device': 'emu64x',
            'system_locale': 'en-GB',
            'has_client_mods': False,
            'client_version': '267.0 - rn',
            'release_channel': 'alpha',
            'device_vendor_id': str(uuid.uuid4()),
            'design_id': 2,
            'browser_user_agent': '', # Not provided here but the user agent is Discord-Android/267200;RNA
            'browser_version': '',
            'os_version': '34',
            'client_build_number': 3616,
            'client_event_source': None,
        }
    else:
        self._super_properties["$os"] = properties[os][0]
        self._super_properties["$browser"] = properties[os][1]
        self._super_properties["$device"] = properties[os][2]

    print("[Session Spoof] Identifying with spoofed properties:", self._super_properties)
    return await original_method(self)

def patch_identify(new_os):
    global original_method, os

    print(f"[Session Spoof] Patching identify method for {new_os}")

    if new_os not in properties:
        os = "desktop"
    else:
        os = new_os
    
    if original_method is None:
        print("[Session Spoof] Storing original identify method")
        original_method = DiscordWebSocket.identify
    elif original_method is new_method:
        print("[Session Spoof] ERROR: original_method is already pointing to new_method! Skipping patch.")
        return

    if DiscordWebSocket.identify is not new_method:
        print("[Session Spoof] Applying patched identify method")
        DiscordWebSocket.identify = new_method
    else:
        print("[Session Spoof] Already patched, skipping")
