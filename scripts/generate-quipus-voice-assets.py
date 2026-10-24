"""Generate the one Quipus voice; credentials stay in environment, never logs."""
from pathlib import Path
import argparse, array, audioop, concurrent.futures, hashlib, json, math, os, subprocess, sys, urllib.request

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument("--base-url", required=True)
parser.add_argument("--from-sources", action="store_true", help="Re-encode validated source clips without a provider request")
parser.add_argument("--vercel", action="store_true", help="Use authenticated Vercel CLI for a protected staging deployment")
parser.add_argument("--only", help="One catalog symbol for a provider-access check")
parser.add_argument("--stage", default=".tmp-firmware-face/marin-assets")
args = parser.parse_args()
profile = json.loads((ROOT / "lib/quipus-voice-profile.json").read_text())
catalog = json.loads((ROOT / "lib/quipus-prompt-text.json").read_text())["prompts"]
token = os.environ.get("QUIPUS_VOICE_BUILD_TOKEN", "")
if not args.from_sources and len(token) != 64:
    raise SystemExit("Set the deployment-only voice build token in the environment.")
if not args.base_url.startswith("https://"):
    raise SystemExit("HTTPS voice generation is required.")
stage = ROOT / args.stage
stage.mkdir(parents=True, exist_ok=True)

def generate(item):
    existing = stage / (item["symbol"] + ".json")
    if existing.exists():
        saved = json.loads(existing.read_text())
        target = stage / item["file"]
        if saved.get("profile") == profile and saved.get("text") == item["text"] and target.is_file():
            if hashlib.sha256(target.read_bytes()).hexdigest() == saved.get("sha256"):
                return saved
    try:
        source = stage / (item["symbol"] + "-source.pcm")
        if args.from_sources:
            if not existing.exists() or not source.is_file(): raise RuntimeError("Missing validated source")
            saved=json.loads(existing.read_text())
            if saved.get("profile") != profile or saved.get("text") != item["text"]: raise RuntimeError("Source voice/text mismatch")
            raw=source.read_bytes()
        elif args.vercel:
            source = stage / (item["symbol"] + "-source.pcm")
            command = [str(Path(os.environ.get("APPDATA", ""))/"npm/vercel.cmd"), "curl",
                "/api/internal/voice-build/"+item["symbol"], "--deployment", args.base_url,
                "--", "--request", "POST", "--header", "Authorization: Bearer "+token,
                "--silent", "--show-error", "--fail", "--output", str(source)]
            result = subprocess.run(command, cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            if result.returncode:
                # Do not raise CalledProcessError: its repr includes authorization arguments.
                message=result.stderr.decode("utf-8","replace").replace(token,"[BUILD_TOKEN]")
                print(message[-500:], file=sys.stderr)
                raise RuntimeError("Protected build request failed")
            if not source.is_file() or source.stat().st_size > 1_440_000:
                raise RuntimeError("Invalid voice response size")
            raw=source.read_bytes()
        else:
            request = urllib.request.Request(args.base_url.rstrip("/") + "/api/internal/voice-build/" + item["symbol"],
                data=b"", method="POST", headers={"Authorization": "Bearer " + token})
            with urllib.request.urlopen(request, timeout=65) as response:
                if not response.headers.get("Content-Type", "").startswith("audio/pcm"):
                    raise RuntimeError("Unexpected voice response format")
                raw = response.read(1_440_002)
    except Exception as error:
        raise RuntimeError("Voice generation failed for " + item["symbol"] + ": " + type(error).__name__) from None
    if not raw or len(raw) % 2 or len(raw) > 1_440_000:
        raise RuntimeError("Invalid or oversized voice audio")
    # Fixed cues have known clean synthesis. Trim only quiet margins, retaining
    #100ms before and160ms after active speech so soft phonemes stay intact.
    hop=960
    active=[i for i in range(0,len(raw),hop) if audioop.rms(raw[i:i+hop],2)>160]
    if not active: raise RuntimeError("Silent generated cue")
    raw=raw[max(0,active[0]-4800):min(len(raw),active[-1]+hop+7680)]
    peak=audioop.max(raw,2)
    raw=audioop.mul(raw,2,min(2.,24000./peak))
    if (len(raw)//2)%2: raw+=b"\x00\x00"
    pcm,_=audioop.lin2adpcm(raw,2,None)
    decoded,_=audioop.adpcm2lin(pcm,2,None)
    values=array.array("h",decoded)
    if sys.byteorder != "little": values.byteswap()
    residual=audioop.rms(audioop.add(raw,audioop.mul(decoded,2,-1),2),2)
    snr=20*math.log10(max(1,audioop.rms(raw,2))/max(1,residual))
    metadata=dict(item,bytes=len(pcm),samples=len(decoded)//2,seconds=round(len(decoded)/48000,3),
        peak=max(abs(v) for v in values),rms=audioop.rms(decoded,2),snr_db=round(snr,2),
        sha256=hashlib.sha256(pcm).hexdigest(),decoded_sha256=hashlib.sha256(decoded).hexdigest(),profile=profile)
    output = stage / item["file"]
    output.with_suffix(".part").write_bytes(pcm)
    output.with_suffix(".part").replace(output)
    existing.write_text(json.dumps(metadata, indent=2)+"\n")
    print(item["symbol"], metadata["seconds"], "seconds", flush=True)
    return metadata

selected = [i for i in catalog if not args.only or i["symbol"] == args.only]
if not selected: raise SystemExit("Unknown catalog symbol")
with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
    items = list(executor.map(generate, selected))
if not args.only:
    payload = {"generator": "OpenAI generated speech; one shared original assistant voice", "profile": profile,
        "prompts": [{k:v for k,v in i.items() if k != "profile"} for i in items]}
    (stage / "prompts.json").write_text(json.dumps(payload,indent=2)+"\n")
    print("Validated", len(items), "single-voice assets;", sum(i["bytes"] for i in items), "bytes")
