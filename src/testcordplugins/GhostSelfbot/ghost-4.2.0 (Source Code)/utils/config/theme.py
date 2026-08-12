import json

from utils import files

class Theme:
    def __init__(self, config, **kwargs):
        self.config = config
        self.name = kwargs.get("name")
        self.title = kwargs.get("title")
        self.emoji = kwargs.get("emoji")
        self.image = kwargs.get("image")
        self.colour = kwargs.get("colour")
        self.footer = kwargs.get("footer")

    def set(self, key, value):
        setattr(self, key, value)

    def save(self, notify=True):
        with open(files.get_application_support() + f"/themes/{self.name}.json", "w") as f:
            json.dump({
                "title": self.title,
                "emoji": self.emoji,
                "image": self.image,
                "colour": self.colour,
                "footer": self.footer
            }, f, indent=4)
            
        if notify:
            self.config.notify_subscribers()

    def __str__(self):
        return self.name

    def to_dict(self):
        return {
            "title": self.title,
            "emoji": self.emoji,
            "image": self.image,
            "colour": self.colour,
            "footer": self.footer
        }