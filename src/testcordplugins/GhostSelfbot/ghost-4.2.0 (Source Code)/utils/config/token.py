import json
import os

from utils import files

class Token:
    def __init__(self, token, username, id):
        self.path = files.get_application_support() + "/data/sensitive/tokens.json"
        self.tokens_file = self.load_tokens()
        self.token = token
        self.username = username
        self.id = id
        
    def load_tokens(self):
        if os.path.exists(self.path):
            with open(self.path, "r") as f:
                return json.load(f)
        else:
            return []
        
    def to_dict(self):
        return {
            "token": self.token,
            "username": self.username,
            "id": self.id
        }
        
    def save(self):
        self.tokens_file.append(self.to_dict())
        with open(self.path, "w") as f:
            json.dump(self.tokens_file, f, indent=4)
            
    def delete(self):
        self.tokens_file = [token for token in self.tokens_file if token["token"] != self.token]
        with open(self.path, "w") as f:
            json.dump(self.tokens_file, f, indent=4)