from flask import Flask, request, jsonify
import tensorflow as tf
import numpy as np
from PIL import Image
import io

app = Flask(__name__)

# Charger ton modèle TFLite
interpreter = tf.lite.Interpreter(model_path="../output/camera_microscope_model.tflite")
interpreter.allocate_tensors()
input_details = interpreter.get_input_details()
output_details = interpreter.get_output_details()

@app.route("/upload", methods=["POST"])
def upload():
    img_bytes = request.data
    img = Image.open(io.BytesIO(img_bytes)).resize((96,96)).convert("L")
    arr = np.array(img).reshape(1,96,96,1).astype(np.float32)/255.0

    interpreter.set_tensor(input_details[0]['index'], arr)
    interpreter.invoke()
    output = interpreter.get_tensor(output_details[0]['index'])[0]

    labels = ["Camera", "Microscope"]
    label = labels[np.argmax(output)]
    confidence = float(np.max(output))

    return jsonify({"label": label, "confidence": confidence})

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)
