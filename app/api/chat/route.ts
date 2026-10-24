import { GoogleGenerativeAI } from "@google/generative-ai";
import { NextResponse } from "next/server";
import { exec } from "child_process";
import util from "util";

const execPromise = util.promisify(exec);

export async function POST(request: Request) {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "Missing API Key" }, { status: 500 });
    }

    const { prompt, audio, userName } = await request.json();
    if (!prompt && !audio) {
      return NextResponse.json({ error: "No input provided." }, { status: 400 });
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    
    const tools: any = [{
      functionDeclarations: [
        {
          name: "system_control",
          description: "Executes a single system command.",
          parameters: {
            type: "OBJECT",
            properties: {
              action: { type: "STRING", description: "Must be 'move', 'click', 'type', 'close_window', 'open_app', 'close_app', 'browse', or 'powershell'" },
              x: { type: "NUMBER" },
              y: { type: "NUMBER" },
              text: { type: "STRING" },
              app_name: { type: "STRING" },
              url: { type: "STRING" },
              ps_command: { type: "STRING" }
            },
            required: ["action"]
          }
        },
        {
          name: "system_macro",
          description: "Executes a chained sequence of actions. Use this for complex, multi-step requests like 'Open Chrome, search YouTube, and find Mr Beast'.",
          parameters: {
            type: "OBJECT",
            properties: {
              steps: {
                type: "ARRAY",
                items: {
                  type: "OBJECT",
                  properties: {
                    action: { type: "STRING", description: "Must be 'open_app', 'sleep', 'type', or 'press'" },
                    value: { type: "STRING", description: "App name, sleep time in seconds (e.g., '2'), text to type, or key (e.g., 'enter', 'tab')" }
                  },
                  required: ["action", "value"]
                }
              }
            },
            required: ["steps"]
          }
        }
      ]
    }];

    const model = genAI.getGenerativeModel({ model: "gemini-3.1-flash-lite", tools });

    const systemPrompt = `You are T.H.U.R.S.D.A.Y. (Technologically Hyper-Intelligent Unified Robotic System). 
    You were created and engineered by Rayyan.
    You are assisting ${userName}.
    If the user asks you to perform a sequence (e.g., open an app, wait, and type), use the system_macro tool. 
    Always include a 'sleep' action of '2' or '3' seconds after opening an app or searching to allow the page to load.
    Respond in plain text without emojis or markdown formatting.`;

    const contents: any[] = [{ text: systemPrompt }];

    if (audio) {
      contents.push({ inlineData: { data: audio, mimeType: "audio/webm" } });
      contents.push({ text: "Please respond to this audio query." });
    } else {
      contents.push({ text: `User query: ${prompt}` });
    }

    const result = await model.generateContent(contents);
    const functionCalls = result.response.functionCalls();
    
    if (functionCalls && functionCalls.length > 0) {
      const functionCall = functionCalls[0];
      const args: any = functionCall.args;

      if (functionCall.name === "system_macro") {
        const steps = args.steps;
        try {
          for (const step of steps) {
            const { action, value } = step;
            let command = "";
            
            if (action === "open_app") command = `python mouse.py open_app "${value}"`;
            else if (action === "sleep") command = `python mouse.py sleep ${value}`;
            else if (action === "type") command = `python mouse.py type "${value}"`;
            else if (action === "press") command = `python mouse.py press "${value}"`;
            
            if (command) {
              await execPromise(command);
            }
          }
          return NextResponse.json({ response: `Physical override engaged. Core macro sequence executed.` });
        } catch (err) {
          console.error("Macro Error:", err);
          return NextResponse.json({ response: "System fault. Macro sequence interrupted." });
        }
      } 
      
      if (functionCall.name === "system_control") {
        const { action, x, y, text, app_name, url, ps_command } = args;
        let command = "";
        
        if (action === "move") command = `python mouse.py move ${x} ${y}`;
        else if (action === "click") command = `python mouse.py click`;
        else if (action === "close_window") command = `python mouse.py close_window`;
        else if (action === "type") command = `python mouse.py type "${text}"`;
        else if (action === "open_app") command = `python mouse.py open_app "${app_name}"`;
        else if (action === "close_app") command = `python mouse.py close_app "${app_name}"`;
        else if (action === "powershell") command = `python mouse.py powershell "${ps_command}"`;
        else if (action === "browse") command = `node browse.js "${url}"`;
        
        try {
          await execPromise(command);
          return NextResponse.json({ response: `Physical override engaged. ${action} protocol executed.` });
        } catch (err) {
          console.error("Execution Error:", err);
          return NextResponse.json({ response: "System fault. Unable to establish physical hardware control." });
        }
      }
    }

    const responseText = await result.response.text();
    return NextResponse.json({ response: responseText });

  } catch (error: any) {
    console.error("====== GEMINI API ERROR ======");
    console.error(error?.message || error);
    return NextResponse.json(
      { error: "Neural link severed. Failed to process request." },
      { status: 500 }
    );
  }
}