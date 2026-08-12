import re
from enum import Enum

class Colour(Enum):
    PINK = "\u001b[0;35m"
    RED = "\u001b[0;31m"
    YELLOW = "\u001b[0;33m"
    GREEN = "\u001b[0;32m"
    CYAN = "\u001b[0;36m"
    BLUE = "\u001b[0;34m"
    WHITE = "\u001b[0;37m"
    GREY = "\u001b[0;30m"
    BOLD = "\u001b[1;30m"
    UNDERLINE = "\u001b[4;30m"
    BOLD_UNDERLINE = "\u001b[14;30m"
    RESET = "\u001b[0;0m"
    
    PINK_BOLD = "\u001b[1;35m"
    RED_BOLD = "\u001b[1;31m"
    YELLOW_BOLD = "\u001b[1;33m"
    GREEN_BOLD = "\u001b[1;32m"
    CYAN_BOLD = "\u001b[1;36m"
    BLUE_BOLD = "\u001b[1;34m"
    WHITE_BOLD = "\u001b[1;37m"
    
    PINK_UNDERLINE = "\u001b[4;35m"
    RED_UNDERLINE = "\u001b[4;31m"
    YELLOW_UNDERLINE = "\u001b[4;33m"
    GREEN_UNDERLINE = "\u001b[4;32m"
    CYAN_UNDERLINE = "\u001b[4;36m"
    BLUE_UNDERLINE = "\u001b[4;34m"
    WHITE_UNDERLINE = "\u001b[4;37m"
    
    PINK_BOLD_UNDERLINE = "\u001b[14;35m"
    RED_BOLD_UNDERLINE = "\u001b[14;31m"
    YELLOW_BOLD_UNDERLINE = "\u001b[14;33m"
    GREEN_BOLD_UNDERLINE = "\u001b[14;32m"
    CYAN_BOLD_UNDERLINE = "\u001b[14;36m"
    BLUE_BOLD_UNDERLINE = "\u001b[14;34m"
    WHITE_BOLD_UNDERLINE = "\u001b[14;37m"
    
    def __str__(self):
        return self.value

class Codeblock:
    def __init__(self, title, description = "", footer = "", extra_title = "", style="asciidoc"):
        self.title = title.replace("`", "")
        self.description = "\n> ".join([line.replace("`", "") for line in description.split("\n")])
        self.footer = footer.replace("`", "")
        self.extra_title = extra_title.replace("`", "")
        self.style = style.replace("`", "")

        if self.extra_title != "":
            self.extra_title = f" {self.extra_title}"

    def _parse(self, text):
        # Replace **bold** with ANSI bold color
        text = re.sub(r'\*\*(.*?)\*\*', rf'{Colour.WHITE_BOLD}\1{Colour.RESET}', text)

        # Replace __underline__ with ANSI underline color
        text = re.sub(r'__(.*?)__', rf'{Colour.WHITE_UNDERLINE}\1{Colour.RESET}', text)

        # Replace **__bold underline__** with ANSI bold+underline color
        text = re.sub(r'\*\*__(.*?)__\*\*', rf'{Colour.WHITE_BOLD_UNDERLINE}\1{Colour.RESET}', text)

        return text

    def _generate_title(self):
        title = f"{Colour.BLUE_BOLD}{self.title}"
        if self.extra_title != "":
            title += f"{Colour.GREY}{self.extra_title}"
        
        return title + f"{Colour.RESET}"
            
    def _generate_description(self):
        desc = self.description.split("\n")
        return "\n".join([self._parse(line) for line in desc])  # Apply parsing to every line

    def _generate_footer(self):
        return f"{Colour.GREY}{self.footer}{Colour.RESET}"

    def __str__(self):
        if self.description == "":
            return f"> ```ini\n> [ {self.title} ]{self.extra_title}```"
        elif self.description != "" and self.footer == "":
            return f"> ```ini\n> [ {self.title} ]{self.extra_title}``````{self.style}\n> {self.description}```"
        else:
            return f"""> ```ini\n> [ {self.title} ]{self.extra_title}``````{self.style}\n> {self.description}``````ini\n> ; {self.footer}```"""

        # title = self._generate_title()
        # description = self._generate_description()
        # footer = self._generate_footer()
        
        # return f"```ansi\n{title}\n{description}\n{footer}```"