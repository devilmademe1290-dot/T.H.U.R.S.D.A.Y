import sys
import pyautogui
import time
import os

# Disable the failsafe for this specific integration
pyautogui.FAILSAFE = False 

try:
    command = sys.argv[1]
    
    if command == "move":
        x = int(sys.argv[2])
        y = int(sys.argv[3])
        pyautogui.moveTo(x, y, duration=0.5)
        print(f"Success: Moved to {x},{y}")
        
    elif command == "click":
        pyautogui.click()
        print("Success: Clicked")
        
    elif command == "type":
        text = " ".join(sys.argv[2:])
        pyautogui.write(text, interval=0.02)
        print("Success: Typed text")
        
    elif command == "press":
        key = sys.argv[2]
        pyautogui.press(key)
        print(f"Success: Pressed {key}")
        
    elif command == "sleep":
        seconds = float(sys.argv[2])
        time.sleep(seconds)
        print(f"Success: Slept {seconds}s")
        
    elif command == "close_window":
        pyautogui.hotkey('alt', 'f4')
        print("Success: Closed window")
        
    elif command == "open_app":
        app_name = " ".join(sys.argv[2:])
        pyautogui.press('win')
        time.sleep(0.5)
        pyautogui.write(app_name, interval=0.05)
        time.sleep(0.5)
        pyautogui.press('enter')
        print(f"Success: Opened {app_name}")
        
    elif command == "close_app":
        app_name = sys.argv[2].replace('.exe', '')
        os.system(f'taskkill /F /IM {app_name}.exe /T')
        print(f"Success: Closed {app_name}")
        
    elif command == "powershell":
        ps_command = " ".join(sys.argv[2:])
        os.system(f'start powershell -NoExit -Command "{ps_command}"')
        print("Success: Executed PowerShell script")
        
except Exception as e:
    print(f"Error: {e}")