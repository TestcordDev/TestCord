import sys
import ttkbootstrap as ttk

class LoadingPage:
    def __init__(self, root):
        self.root = root
        
    def clear(self):
        for widget in self.root.winfo_children():
            widget.destroy()
        
    def draw(self, parent, type="start"):
        loading_label = ttk.Label(parent, text="Ghost is starting..." if type == "start" else "Ghost is restarting...", font=("Host Grotesk", 14 if sys.platform != "darwin" else 20, "bold"), anchor="center")
        loading_label.place(relx=0.5, rely=0.5, anchor="center")
        parent.pack_propagate(False)
        
        return loading_label