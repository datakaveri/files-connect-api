import pytest
from PIL import Image
from PIL.PngImagePlugin import PngInfo

from unstructured_metrics.file_openability import check_file_openability
from unstructured_metrics.metadata_parser import get_image_metadata


@pytest.mark.parametrize("extension", ["png", "jpg", "tiff"])
def test_image_openability_with_patched_pillow(tmp_path, extension):
    image_path = tmp_path / f"sample.{extension}"
    Image.new("RGB", (8, 8), color="blue").save(image_path)
    (tmp_path / "corrupt.png").write_bytes(b"not an image")

    result = check_file_openability(tmp_path)

    assert result["openable_files"] == [image_path.name]
    assert result["not_openable_files"] == ["corrupt.png"]
    assert result["file_openable_percentage"] == 50


def test_png_metadata_with_patched_pillow(tmp_path):
    image_path = tmp_path / "metadata.png"
    metadata = PngInfo()
    metadata.add_text("Description", "Dataset preview")
    Image.new("RGB", (8, 8)).save(image_path, pnginfo=metadata)

    assert get_image_metadata(image_path)["Description"] == "Dataset preview"
