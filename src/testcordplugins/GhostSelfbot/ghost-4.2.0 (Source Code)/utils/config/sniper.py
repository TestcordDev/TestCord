from utils.webhook import Webhook

class Sniper:
    def __init__(self, config, **kwargs):
        self.name = kwargs.get("name")
        self.enabled = kwargs.get("enabled")
        self.ignore_invalid = kwargs.get("ignore_invalid")
        self.webhook = kwargs.get("webhook")
        self.config = config

    def save(self, notify=True):
        self.config.config["snipers"][self.name] = self.to_dict()
        self.config.save(notify=notify)

    def __str__(self):
        return self.name

    def to_dict(self):
        return {
            "enabled": self.enabled,
            "ignore_invalid": self.ignore_invalid,
            "webhook": self.webhook,
            "name": self.name
        }

    def set(self, key, value):
        setattr(self, key, value)

    def get_webhook(self):
        return Webhook.from_url(self.webhook)

    def set_webhook(self, webhook, notify=True):
        try:
            self.webhook = webhook.url
        except:
            self.webhook = webhook
        self.save(notify=notify)

    def enable(self):
        self.enabled = True
        self.save()

    def disable(self):
        self.enabled = False
        self.save()

    def toggle(self):
        self.enabled = not self.enabled
        self.save()

    def ignore_invalid(self):
        self.ignore_invalid = True
        self.save()

    def toggle_ignore_invalid(self):
        self.ignore_invalid = not self.ignore_invalid
        self.save()