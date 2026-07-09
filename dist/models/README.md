# Self-hosted Kokoro TTS model
#
# Populated by: npm run download:kokoro
# Deployed with the site so browsers load weights from this origin
# (then Cache API), instead of Hugging Face on every first visit.
#
# Layout after download:
#   Kokoro-82M-v1.0-ONNX/
#     config.json
#     tokenizer.json
#     tokenizer_config.json
#     onnx/model_quantized.onnx   (~92MB, dtype q8)
#     voices/af_heart.bin
