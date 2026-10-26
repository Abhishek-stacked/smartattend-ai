from fastapi import UploadFile

from app.core.config import get_settings
from app.core.errors import AppError

ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/png"}


def read_image_upload(file: UploadFile) -> bytes:
    if file.content_type not in ALLOWED_IMAGE_TYPES:
        raise AppError(415, "unsupported_media_type", "Upload a JPEG or PNG image")
    limit = get_settings().max_upload_bytes
    data = file.file.read(limit + 1)
    if len(data) > limit:
        raise AppError(413, "file_too_large", f"Each image must be at most {limit // (1024 * 1024)} MB")
    if not data:
        raise AppError(422, "empty_file", "The uploaded image is empty")
    return data
