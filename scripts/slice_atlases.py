#!/usr/bin/env python3
"""
圖集切片 + 去背（輸出透明 PNG 到 public/assets/sprites/ 與 public/assets/prizes/）

去背原則：貼紙外圍有一條細灰線（約 #E6E6E6）圈住貼紙，線外係純白底、線內係白色描邊。
所以只清走「同圖邊緣連通、而且冇被灰線隔開」嘅近白像素 → 白底去除，貼紙白描邊同物件內部白色保留。
若某格灰線唔封閉（白底滲入），會用「離物件 R px 內先保留」嘅距離保護做後備。

用法：python3 scripts/slice_atlases.py
"""
from pathlib import Path
import numpy as np
from PIL import Image
from scipy import ndimage as ndi

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / "public" / "assets"
OUT = ASSETS / "sprites"
PRIZES = ASSETS / "prizes"
BG_T = 244  # >= 呢個值先當白底
FALLBACK_R = 26  # 後備：白色超出物件呢個距離就當白底

ATLASES = {
    "ragdoll-atlas-4": [
        "cannon_mid", "cannon_mid_fire", "cannon_left", "cannon_right",
        "@board", None, "gate_window", "fx_hit_star",
        "payout_slot", "gutter_cover", "payout_beam", "fx_slot_flash",
        "plaque_burst", "plaque_ribbon", "plaque_flags", "plaque_shield",
    ],
    "prizes-atlas": [
        "coins_s", "coins_l", "tickets_3", "badge_crown",
        "doll_wizard", "doll_rocket", "ring_rainbow", "cape_royal",
        "trophy_paw", "chest_cat", "prize_drum", "prize_hat",
        "prize_collar", "prize_wand", "prize_pillow", "prize_diamond",
    ],
    "minigames-atlas": [
        "mg_hole", "mg_cat_pop", "mg_cat_gold", "mg_cat_hit",
        "mg_wheel", "mg_pointer", "mg_hub", "mg_flash",
        "mg_gacha", "mg_egg_bronze", "mg_egg_silver", "mg_egg_gold",
        "mg_egg_open", "mg_num3", "mg_num2", "mg_num1",
    ],
    # 冒險打怪 + 寵物房（第 3、4 行預留畀寵物房）
    "adventure-pet-atlas": [
        "adv_hero_walk1", "adv_hero_walk2", "adv_hero_slash", "adv_hero_dizzy",
        "adv_mouse", "adv_clown", "adv_monkey", "adv_lion",
        "pet_food_salmon", "pet_food_can", "pet_toy_teaser", "pet_toy_yarn",
        "pet_hat_wizard", "pet_cape_royal", "pet_clown_nose_bow", "pet_wings",
    ],
    # 特殊道具 / 獎勵圖示 / 巨型貓爪 / 布偶貓小窩立繪
    "special-items-atlas": [
        "sp_gacha_front", "sp_gacha_side", "sp_gacha_open", "sp_rainbow_cat_ball",
        "sp_gem_front", "sp_gem_side", "sp_cat_bell", "sp_fish_token",
        "sp_magic_circle", "sp_reward_ticket", "sp_reward_score", "sp_reward_luck",
        "sp_drop_beam", "adv_giant_paw", "pet_cat_idle", "pet_cat_happy",
    ],
    # 分支小遊戲 + 齊射按鈕（HIGH / LOW 按鈕自帶文字，程式唔再疊字）
    "branch-games-atlas": [
        "bg_mode1", "bg_mode3", "bg_mode5", "bg_star",
        "bg_egg_bronze", "bg_egg_silver", "bg_egg_gold", "bg_egg_open",
        "bg_wheel", "bg_hub", "bg_stand", "bg_chest",
        "bg_card_back", "bg_card_face", "bg_high", "bg_low",
    ],
    # 第 5、6 格（進度條外框 + 填充）同格 5-6 連埋一齊，另行用連通區分開
    "ui-icons-atlas": [
        "ui_ticket", "ui_star", "ui_coin", "ui_clover",
        "@bars", None, "ui_jp_pink", "ui_jp_cyan",
        "ui_jp_gold", "ui_flame", "ui_target", "ui_check",
        "ui_gear", "ui_sound", "ui_crown", "ui_wand",
    ],
}


def key_out(rgb: np.ndarray) -> np.ndarray:
    """回傳 alpha (uint8)。"""
    h, w, _ = rgb.shape
    white = rgb.min(axis=2) >= BG_T
    lab, n = ndi.label(white)  # 4 鄰域
    edge = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]])).tolist()) - {0}
    bg = np.isin(lab, list(edge))
    # 後備：灰線不封閉時，白底會連埋白描邊一齊被清；用距離保護白描邊
    obj = ~white
    dist = ndi.distance_transform_edt(~obj)
    near = dist <= FALLBACK_R
    bg &= ~near | ~white  # 離物件近嘅白色保留（白描邊）
    # 但如果灰線封閉，白描邊已經本來就唔連通；近距離保護只會多留少許白底（<R px），可接受
    # → 為免多留白底，若灰線封閉就唔使保護：以「去除保護後面積」同「保護後面積」比較
    bg_strict = np.isin(lab, list(edge))
    # 判斷灰線係咪封閉：strict 去背之後，剩餘最大連通塊應該離邊緣有一段距離
    keep_strict = ~bg_strict
    k_lab, kn = ndi.label(keep_strict)
    if kn:
        sizes = ndi.sum(keep_strict, k_lab, range(1, kn + 1))
        big = k_lab == (int(np.argmax(sizes)) + 1)
        ys, xs = np.where(big)
        closed = xs.min() > 0 and ys.min() > 0 and xs.max() < w - 1 and ys.max() < h - 1
        # 白描邊應該被保留：strict 保留面積 ≥ 非白面積 * 1.05 即有白描邊
        has_border = keep_strict.sum() > obj.sum() * 1.05
        if closed and has_border:
            bg = bg_strict
    keep = ~bg
    # 去細碎雜點（< 40px 孤立塊）但保留大塊（光暈、星星等稍大，所以只清極小）
    k_lab, kn = ndi.label(keep, structure=np.ones((3, 3)))
    if kn:
        sizes = ndi.sum(keep, k_lab, range(1, kn + 1))
        biggest = sizes.max()
        edge_ids = set(np.unique(np.concatenate([k_lab[0], k_lab[-1], k_lab[:, 0], k_lab[:, -1]])).tolist()) - {0}
        for i, s in enumerate(sizes, 1):
            # 極小雜點，或者貼住格邊、細過主體 12% 嘅碎塊（鄰格貼紙白邊漏入嚟）
            if s < 40 or (i in edge_ids and s < biggest * 0.12):
                keep[k_lab == i] = False
    a = keep.astype(np.float32)
    a = ndi.gaussian_filter(a, 0.8)
    a = np.clip((a - 0.25) / 0.5, 0, 1)
    a[keep & (a > 0.9)] = 1
    return (a * 255).astype(np.uint8)


def trim_save(rgb: np.ndarray, alpha: np.ndarray, path: Path, pad: int = 4) -> tuple[int, int]:
    ys, xs = np.where(alpha > 8)
    if len(xs) == 0:
        raise SystemExit(f"空白：{path}")
    y0, y1 = max(0, ys.min() - pad), min(rgb.shape[0], ys.max() + 1 + pad)
    x0, x1 = max(0, xs.min() - pad), min(rgb.shape[1], xs.max() + 1 + pad)
    out = np.dstack([rgb[y0:y1, x0:x1], alpha[y0:y1, x0:x1]])
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(out, "RGBA").save(path, optimize=True)
    return out.shape[1], out.shape[0]


def main() -> None:
    for atlas, names in ATLASES.items():
        im = np.array(Image.open(ASSETS / f"{atlas}.jpeg").convert("RGB"))
        cw, ch = im.shape[1] // 4, im.shape[0] // 4
        for i, name in enumerate(names):
            if name is None:
                continue
            col, row = i % 4, i // 4
            if name in ("@bars", "@board"):
                # 橫跨 2 格嘅兩件物件：用連通塊分開（bars 上下排，board 左右排）
                cell = im[row * ch:(row + 1) * ch, 0:2 * cw]
                a = key_out(cell)
                lab, n = ndi.label(a > 40, structure=np.ones((3, 3)))
                sizes = ndi.sum(a > 40, lab, range(1, n + 1))
                axis = 0 if name == "@bars" else 1
                top2 = sorted(np.argsort(sizes)[-2:] + 1, key=lambda l: ndi.center_of_mass(lab == l)[axis])
                names2 = ["ui_luck_frame", "ui_luck_fill"] if name == "@bars" else ["gate_board", "gate_trim"]
                for l, nm in zip(top2, names2):
                    m = ndi.binary_dilation(lab == l, iterations=3)
                    alpha = np.where(m, a, 0).astype(np.uint8)
                    if nm == "ui_luck_frame":
                        # 外框中間白色底挖空，疊喺漸層填充上面先睇到運氣值
                        alpha[cell.min(axis=2) >= 238] = 0
                    w, h = trim_save(cell, alpha, OUT / f"{nm}.png")
                    print(f"{nm:18s}{w}x{h}")
                continue
            cell = im[row * ch:(row + 1) * ch, col * cw:(col + 1) * cw]
            a = key_out(cell)
            if name == "mg_wheel":
                # 輪盤會旋轉：裁成正圓（去走白貼紙邊嘅不規則外形），圓半徑剛好包住金邊深色外框
                ys, xs = np.where(a > 8)
                cx, cy, d = (xs.min() + xs.max()) / 2, (ys.min() + ys.max()) / 2, xs.max() - xs.min()
                yy, xx = np.mgrid[0:a.shape[0], 0:a.shape[1]]
                a = np.where((xx - cx) ** 2 + (yy - cy) ** 2 <= (0.458 * d) ** 2, a, 0).astype(np.uint8)
            dst = (PRIZES if atlas == "prizes-atlas" and not name.startswith("prize_") else OUT) / f"{name}.png"
            w, h = trim_save(cell, a, dst)
            print(f"{name:18s}{w}x{h}")

    # 機台無縫材質 2×2：左上 紫絨星芒貓爪地板 / 右上 粉白金紋後板 / 左下 紅白前擋板 / 右下 深紅菱格絨面
    tex = Image.open(ASSETS / "machine-textures-2x2.jpeg").convert("RGB")
    hw, hh = tex.width // 2, tex.height // 2
    tiles_dir = ASSETS / "tiles"
    tiles_dir.mkdir(exist_ok=True)
    for i, nm in enumerate(["tile_floor", "tile_rear", "tile_front", "tile_quilt"]):
        q = tex.crop(((i % 2) * hw, (i // 2) * hh, (i % 2) * hw + hw, (i // 2) * hh + hh)).resize((512, 512), Image.LANCZOS)
        q.save(tiles_dir / f"{nm}.jpeg", quality=88)
        print(f"{nm:18s}512x512")

    # App icon：去背、置中放入 512×512 透明畫布
    icon = np.array(Image.open(ASSETS / "app-icon.jpeg").convert("RGB"))
    a = key_out(icon)
    ys, xs = np.where(a > 8)
    crop = Image.fromarray(np.dstack([icon, a]), "RGBA").crop((xs.min(), ys.min(), xs.max() + 1, ys.max() + 1))
    s = 480 / max(crop.size)
    crop = crop.resize((round(crop.width * s), round(crop.height * s)), Image.LANCZOS)
    canvas = Image.new("RGBA", (512, 512), (0, 0, 0, 0))
    canvas.paste(crop, ((512 - crop.width) // 2, (512 - crop.height) // 2), crop)
    canvas.save(ASSETS / "app-icon.png", optimize=True)
    print("app-icon.png 512x512")


if __name__ == "__main__":
    main()
