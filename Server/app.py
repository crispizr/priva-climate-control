from flask import Flask, request, jsonify, render_template
from PIL import Image
import numpy as np
import tflite_runtime.interpreter as tflite
import io
import os

app = Flask(__name__, static_folder="static", template_folder="templates")

# Obtenir le chemin absolu du dossier Server
BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# Charger le modèle TFLite
model_path = os.path.join(BASE_DIR, "camera_microscope_model.tflite")
print(f"Loading model from: {model_path}")
interpreter = tflite.Interpreter(model_path=model_path)
interpreter.allocate_tensors()

input_details = interpreter.get_input_details()
output_details = interpreter.get_output_details()

# Charger les labels
labels_path = os.path.join(BASE_DIR, "labels.txt")
try:
    with open(labels_path) as f:
        labels = [line.strip() for line in f.readlines()]
    print(f"Loaded labels: {labels}")
except FileNotFoundError:
    print("labels.txt not found, using defaults")
    labels = ["Camera", "Microscope"]

# ROUTE SIMPLE POUR TESTER
@app.route("/")
def index():
    # Version simple sans template pour tester
    return """
    <!DOCTYPE html>
    <html>
    <head>
        <title>Classification Camera vs Microscope</title>
        <style>
            body { font-family: Arial; max-width: 600px; margin: 50px auto; padding: 20px; }
            input, button { margin: 10px 0; padding: 10px; }
            button { background: #4CAF50; color: white; border: none; cursor: pointer; }
            #result { margin-top: 20px; padding: 15px; background: #e8f5e9; border-radius: 5px; display: none; }
        </style>
    </head>
    <body>
        <h1>🔬 Classification d'Images</h1>
        <p>Uploadez une image (caméra ou microscope)</p>
        
        <form id="uploadForm">
            <input type="file" id="fileInput" accept="image/*" required><br>
            <button type="submit">Analyser</button>
        </form>
        
        <div id="result"></div>
        
        <script>
            document.getElementById('uploadForm').addEventListener('submit', async (e) => {
                e.preventDefault();
                const formData = new FormData();
                formData.append('file', document.getElementById('fileInput').files[0]);
                
                try {
                    const response = await fetch('/upload', { method: 'POST', body: formData });
                    const data = await response.json();
                    
                    if (response.ok) {
                        document.getElementById('result').innerHTML = 
                            '<h3>Résultat:</h3>' +
                            '<p><strong>Prédiction:</strong> ' + data.label + '</p>' +
                            '<p><strong>Confiance:</strong> ' + (data.confidence * 100).toFixed(2) + '%</p>';
                        document.getElementById('result').style.display = 'block';
                    } else {
                        alert('Erreur: ' + data.error);
                    }
                } catch (error) {
                    alert('Erreur: ' + error.message);
                }
            });
        </script>
    </body>
    </html>
    """

@app.route('/upload', methods=['POST'])
def upload():
    try:
        if 'file' not in request.files:
            return jsonify({"error": "No file uploaded"}), 400
        
        file = request.files['file']
        image = Image.open(file.stream).convert("RGB")
        
        input_shape = input_details[0]['shape']
        target_size = (input_shape[1], input_shape[2])
        image = image.resize(target_size)
        
        input_dtype = input_details[0]['dtype']
        if input_dtype == np.uint8:
            input_data = np.expand_dims(np.array(image, dtype=np.uint8), axis=0)
        else:
            input_data = np.expand_dims(np.array(image, dtype=np.float32) / 255.0, axis=0)
        
        interpreter.set_tensor(input_details[0]['index'], input_data)
        interpreter.invoke()
        
        output_data = interpreter.get_tensor(output_details[0]['index'])
        probs = output_data[0].tolist()
        predicted_class = int(np.argmax(probs))
        confidence = float(np.max(probs))
        label = labels[predicted_class] if predicted_class < len(labels) else "Unknown"
        
        return jsonify({
            "label": label,
            "confidence": confidence,
            "probabilities": dict(zip(labels, probs))
        })
    
    except Exception as e:
        return jsonify({"error": str(e)}), 500

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port)
