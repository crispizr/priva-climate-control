from flask import Flask, request, jsonify
from PIL import Image
import numpy as np
import tensorflow as tf
import io
import os

app = Flask(__name__)

# Obtenir le chemin absolu du dossier Server
BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# Charger le modèle TFLite
model_path = os.path.join(BASE_DIR, "camera_microscope_model.tflite")
print(f"Loading model from: {model_path}")
interpreter = tf.lite.Interpreter(model_path=model_path)
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

@app.route("/")
def index():
    return """
    <!DOCTYPE html>
    <html lang="fr">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Classification Camera vs Microscope</title>
        <style>
            * {
                margin: 0;
                padding: 0;
                box-sizing: border-box;
            }
            
            body {
                font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                min-height: 100vh;
                display: flex;
                justify-content: center;
                align-items: center;
                padding: 20px;
            }
            
            .container {
                background: white;
                border-radius: 20px;
                box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
                max-width: 600px;
                width: 100%;
                padding: 40px;
            }
            
            h1 {
                color: #333;
                text-align: center;
                margin-bottom: 10px;
                font-size: 28px;
            }
            
            .subtitle {
                text-align: center;
                color: #666;
                margin-bottom: 30px;
                font-size: 14px;
            }
            
            .upload-area {
                border: 3px dashed #667eea;
                border-radius: 15px;
                padding: 40px;
                text-align: center;
                background: #f8f9ff;
                margin-bottom: 20px;
                transition: all 0.3s ease;
            }
            
            .upload-area:hover {
                border-color: #764ba2;
                background: #f0f1ff;
            }
            
            input[type="file"] {
                display: none;
            }
            
            .file-label {
                display: inline-block;
                padding: 12px 30px;
                background: #667eea;
                color: white;
                border-radius: 25px;
                cursor: pointer;
                font-weight: 600;
                transition: all 0.3s ease;
            }
            
            .file-label:hover {
                background: #764ba2;
                transform: translateY(-2px);
                box-shadow: 0 5px 15px rgba(102, 126, 234, 0.4);
            }
            
            button[type="submit"] {
                width: 100%;
                padding: 15px;
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                color: white;
                border: none;
                border-radius: 25px;
                font-size: 16px;
                font-weight: 600;
                cursor: pointer;
                transition: all 0.3s ease;
                margin-top: 20px;
            }
            
            button[type="submit"]:hover {
                transform: translateY(-2px);
                box-shadow: 0 10px 25px rgba(102, 126, 234, 0.4);
            }
            
            button[type="submit"]:disabled {
                background: #ccc;
                cursor: not-allowed;
                transform: none;
            }
            
            #preview {
                max-width: 100%;
                max-height: 300px;
                border-radius: 10px;
                margin: 20px 0;
                display: none;
                box-shadow: 0 5px 15px rgba(0, 0, 0, 0.2);
            }
            
            #result {
                margin-top: 30px;
                padding: 25px;
                background: linear-gradient(135deg, #e8f5e9 0%, #c8e6c9 100%);
                border-radius: 15px;
                display: none;
                animation: slideIn 0.5s ease;
            }
            
            @keyframes slideIn {
                from {
                    opacity: 0;
                    transform: translateY(20px);
                }
                to {
                    opacity: 1;
                    transform: translateY(0);
                }
            }
            
            #result h3 {
                color: #2e7d32;
                margin-bottom: 15px;
                font-size: 20px;
            }
            
            #result p {
                margin: 10px 0;
                color: #333;
                font-size: 16px;
            }
            
            #result ul {
                list-style: none;
                padding: 0;
                margin-top: 15px;
            }
            
            #result li {
                padding: 8px 0;
                border-bottom: 1px solid rgba(46, 125, 50, 0.2);
                color: #555;
            }
            
            #result li:last-child {
                border-bottom: none;
            }
            
            .loading {
                display: none;
                text-align: center;
                margin: 20px 0;
            }
            
            .spinner {
                border: 4px solid #f3f3f3;
                border-top: 4px solid #667eea;
                border-radius: 50%;
                width: 40px;
                height: 40px;
                animation: spin 1s linear infinite;
                margin: 0 auto;
            }
            
            @keyframes spin {
                0% { transform: rotate(0deg); }
                100% { transform: rotate(360deg); }
            }
            
            .error {
                background: #ffebee;
                color: #c62828;
                padding: 15px;
                border-radius: 10px;
                margin-top: 20px;
                display: none;
            }
        </style>
    </head>
    <body>
        <div class="container">
            <h1>🔬 Classification d'Images</h1>
            <p class="subtitle">Détectez si votre image contient une caméra ou un microscope</p>
            
            <form id="uploadForm">
                <div class="upload-area">
                    <label for="fileInput" class="file-label">
                        📁 Choisir une image
                    </label>
                    <input type="file" id="fileInput" accept="image/*" required>
                    <p style="margin-top: 15px; color: #888; font-size: 13px;">
                        Formats acceptés: JPG, PNG, GIF
                    </p>
                </div>
                
                <img id="preview" alt="Aperçu de l'image">
                
                <button type="submit" id="submitBtn">
                    🚀 Analyser l'image
                </button>
            </form>
            
            <div class="loading">
                <div class="spinner"></div>
                <p style="margin-top: 15px; color: #667eea;">Analyse en cours...</p>
            </div>
            
            <div id="result"></div>
            <div class="error" id="error"></div>
        </div>
        
        <script>
            const fileInput = document.getElementById('fileInput');
            const preview = document.getElementById('preview');
            const form = document.getElementById('uploadForm');
            const resultDiv = document.getElementById('result');
            const errorDiv = document.getElementById('error');
            const loading = document.querySelector('.loading');
            const submitBtn = document.getElementById('submitBtn');
            
            // Prévisualisation de l'image
            fileInput.addEventListener('change', (e) => {
                const file = e.target.files[0];
                if (file) {
                    const reader = new FileReader();
                    reader.onload = (e) => {
                        preview.src = e.target.result;
                        preview.style.display = 'block';
                    };
                    reader.readAsDataURL(file);
                }
            });
            
            // Soumission du formulaire
            form.addEventListener('submit', async (e) => {
                e.preventDefault();
                
                // Réinitialiser l'affichage
                resultDiv.style.display = 'none';
                errorDiv.style.display = 'none';
                loading.style.display = 'block';
                submitBtn.disabled = true;
                
                const file = fileInput.files[0];
                if (!file) {
                    errorDiv.textContent = '⚠️ Veuillez sélectionner une image.';
                    errorDiv.style.display = 'block';
                    loading.style.display = 'none';
                    submitBtn.disabled = false;
                    return;
                }
                
                const formData = new FormData();
                formData.append('file', file);
                
                try {
                    const response = await fetch('/upload', {
                        method: 'POST',
                        body: formData
                    });
                    
                    const data = await response.json();
                    
                    loading.style.display = 'none';
                    submitBtn.disabled = false;
                    
                    if (response.ok) {
                        const confidencePercent = (data.confidence * 100).toFixed(2);
                        const icon = data.label === 'Camera' ? '📷' : '🔬';
                        
                        resultDiv.innerHTML = `
                            <h3>${icon} Résultat de l'analyse</h3>
                            <p><strong>Prédiction:</strong> <span style="font-size: 20px; color: #2e7d32;">${data.label}</span></p>
                            <p><strong>Confiance:</strong> <span style="font-size: 18px; color: #1565c0;">${confidencePercent}%</span></p>
                            <p style="margin-top: 20px;"><strong>Détails des probabilités:</strong></p>
                            <ul>
                                ${Object.entries(data.probabilities).map(([label, prob]) => `
                                    <li>
                                        <strong>${label}:</strong> ${(prob * 100).toFixed(2)}%
                                        <div style="background: #e0e0e0; border-radius: 10px; height: 8px; margin-top: 5px; overflow: hidden;">
                                            <div style="background: linear-gradient(90deg, #667eea, #764ba2); height: 100%; width: ${(prob * 100)}%; transition: width 0.5s ease;"></div>
                                        </div>
                                    </li>
                                `).join('')}
                            </ul>
                        `;
                        resultDiv.style.display = 'block';
                    } else {
                        errorDiv.textContent = `❌ Erreur: ${data.error}`;
                        errorDiv.style.display = 'block';
                    }
                } catch (error) {
                    loading.style.display = 'none';
                    submitBtn.disabled = false;
                    errorDiv.textContent = `❌ Erreur de connexion: ${error.message}`;
                    errorDiv.style.display = 'block';
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
        
        if file.filename == '':
            return jsonify({"error": "No file selected"}), 400
        
        # Lire l'image
        image = Image.open(file.stream).convert("RGB")
        
        # Redimensionner selon les attentes du modèle
        input_shape = input_details[0]['shape']
        target_size = (input_shape[1], input_shape[2])
        image = image.resize(target_size)
        
        # Préparer les données d'entrée
        input_dtype = input_details[0]['dtype']
        if input_dtype == np.uint8:
            input_data = np.expand_dims(np.array(image, dtype=np.uint8), axis=0)
        else:
            input_data = np.expand_dims(np.array(image, dtype=np.float32) / 255.0, axis=0)
        
        # Faire la prédiction
        interpreter.set_tensor(input_details[0]['index'], input_data)
        interpreter.invoke()
        
        # Récupérer les résultats
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
        print(f"Error in upload: {str(e)}")
        return jsonify({"error": str(e)}), 500

@app.route('/health')
def health():
    return jsonify({"status": "healthy", "model_loaded": True})

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=False)
