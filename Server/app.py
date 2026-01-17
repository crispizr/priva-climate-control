from flask import Flask, request, jsonify
from PIL import Image
import numpy as np
import tensorflow as tf
import io
import os

app = Flask(__name__)

# Charger le modèle TFLite
interpreter = tf.lite.Interpreter(model_path="output/camera_microscope_model.tflite")
interpreter.allocate_tensors()

# Infos sur les entrées/sorties
input_details = interpreter.get_input_details()
output_details = interpreter.get_output_details()

# Charger les labels
try:
    with open("labels.txt") as f:
        labels = [line.strip() for line in f.readlines()]
except FileNotFoundError:
    labels = ["Camera", "Microscope"]  # fallback

@app.route('/upload', methods=['POST'])
def upload():
    try:
        if 'file' not in request.files:
            return jsonify({"error": "No file uploaded"}), 400

        file = request.files['file']
        image = Image.open(file.stream).convert("RGB")

        # Adapter la taille à celle attendue par le modèle
        input_shape = input_details[0]['shape']  # ex: [1, 224, 224, 3]
        target_size = (input_shape[1], input_shape[2])
        image = image.resize(target_size)

        # Vérifier le type attendu par le modèle
        input_dtype = input_details[0]['dtype']
        if input_dtype == np.uint8:
            input_data = np.expand_dims(np.array(image, dtype=np.uint8), axis=0)
        else:
            input_data = np.expand_dims(np.array(image, dtype=np.float32) / 255.0, axis=0)

        # Exécuter l'inférence
        interpreter.set_tensor(input_details[0]['index'], input_data)
        interpreter.invoke()
        output_data = interpreter.get_tensor(output_details[0]['index'])

        # Probabilités
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
    port = int(os.environ.get("PORT", 5000))  # Render ou autre PaaS définit PORT
    app.run(host="0.0.0.0", port=port)
