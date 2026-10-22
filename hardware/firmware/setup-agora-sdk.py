"""Install the Agora IoT component used by both Quipus firmware projects."""
from pathlib import Path
import hashlib
import re
import tarfile
import tempfile
from urllib.request import urlopen

SDK_URL = "https://rte-store.s3.amazonaws.com/agora_iot_sdk.tar"
SDK_ROOT = Path(__file__).resolve().parent / "components/agora_iot_sdk"


def install() -> None:
    if (SDK_ROOT / "include/agora_rtc_api.h").is_file():
        print("Agora IoT SDK already installed")
        return
    SDK_ROOT.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="quipus-agora-") as temporary:
        archive = Path(temporary) / "sdk.tar"
        with urlopen(SDK_URL, timeout=120) as response, archive.open("wb") as output:
            while chunk := response.read(1024 * 1024):
                output.write(chunk)
        print("Agora archive SHA-256:", hashlib.sha256(archive.read_bytes()).hexdigest())
        with tarfile.open(archive) as source:
            # Reject paths/links that could escape the component directory.
            for member in source.getmembers():
                target = (SDK_ROOT / member.name).resolve()
                if not target.is_relative_to(SDK_ROOT.resolve()):
                    raise ValueError("SDK archive contains an unsafe path")
                if not (member.isfile() or member.isdir()):
                    raise ValueError("SDK archive contains a link or special file")
            source.extractall(SDK_ROOT)
    cmake_file = SDK_ROOT / "CMakeLists.txt"
    cmake = cmake_file.read_text(encoding="utf-8").replace("\u00a0", " ")
    for library in ("rtsa", "ahpl"):
        cmake = re.sub(
            rf'(add_prebuilt_library\({library}\s+"[^\r\n]+")\s+PRIV_REQUIRES[^\r\n]*\)',
            r'\1 PRIV_REQUIRES lwip pthread)', cmake)
    cmake_file.write_text(cmake, encoding="utf-8")
    if not (SDK_ROOT / "include/agora_rtc_api.h").is_file():
        raise ValueError("Agora SDK header missing after extraction")
    print("Agora IoT SDK installed:", SDK_ROOT)


if __name__ == "__main__":
    install()
