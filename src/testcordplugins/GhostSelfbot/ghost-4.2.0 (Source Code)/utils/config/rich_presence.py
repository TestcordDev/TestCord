import time

from utils.defaults import DEFAULT_RPC

class RichPresence:
    def __init__(self, config, **kwargs):
        self.enabled = kwargs.get("enabled", False)
        self.client_id = "1018195507560063039" # Default client ID for Ghost
        self.state = kwargs.get("state", None)
        self.state_url = kwargs.get("state_url", None)
        self.details = kwargs.get("details", None)
        self.details_url = kwargs.get("details_url", None)
        self.large_image = kwargs.get("large_image", None)
        self.large_text = kwargs.get("large_text", None)
        self.large_url = kwargs.get("large_url", None)
        self.small_image = kwargs.get("small_image", None)
        self.small_text = kwargs.get("small_text", None)
        self.small_url = kwargs.get("small_url", None)
        self.name = kwargs.get("name", None)
        self.config = config
        
    def set(self, key, value):
        setattr(self, key, value)
        
    def get(self, key):
        return getattr(self, key)
        
    def save(self, notify=True):
        self.config.config["rich_presence"] = {
            "enabled": self.enabled,
            "client_id": self.client_id,
            "state": self.state,
            "state_url": self.state_url,
            "details": self.details,
            "details_url": self.details_url,
            "large_image": self.large_image,
            "large_text": self.large_text,
            "large_url": self.large_url,
            "small_image": self.small_image,
            "small_text": self.small_text,
            "small_url": self.small_url,
            "name": self.name
        }
        self.config.save(notify=notify)

    def reset_defaults(self):
        self.config.config["rich_presence"] = DEFAULT_RPC
        self.config.config["rich_presence"]["enabled"] = self.enabled
        self.config.save()
            
    def to_dict(self):
        rpc_dict = {}
        
        if self.state: rpc_dict["state"] = self.state
        if self.details: rpc_dict["details"] = self.details
        if self.large_image: rpc_dict["large_image"] = self.large_image
        if self.large_text: rpc_dict["large_text"] = self.large_text
        if self.small_image: rpc_dict["small_image"] = self.small_image
        if self.small_text: rpc_dict["small_text"] = self.small_text
        if self.small_url: rpc_dict["small_url"] = self.small_url
        if self.large_url: rpc_dict["large_url"] = self.large_url
        if self.state_url: rpc_dict["state_url"] = self.state_url
        if self.details_url: rpc_dict["details_url"] = self.details_url
        if self.client_id: rpc_dict["client_id"] = str(self.client_id)
        if self.name: rpc_dict["name"] = self.name
        rpc_dict["start"] = time.time()
        
        return rpc_dict