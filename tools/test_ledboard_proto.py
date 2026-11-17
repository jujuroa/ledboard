"""
ledboard_proto 단위 테스트 (표준 라이브러리 unittest만 사용)
  python -m unittest discover -s tools -v
"""
import unittest

import ledboard_proto as proto


class HeaderTest(unittest.TestCase):
    def test_size_and_layout(self):
        h = proto.header(proto.T_LED, 2, 0x1_0000_0005, proto.F_COMMIT, 3, 4, 5, 6, timestamp=0x1234)
        self.assertEqual(len(h), 24)
        # 시뮬레이터 parseHeader의 오프셋: magic 0-1, version 2, type 3, format 4, flags 5,
        # seq 8 (u32), timestamp 12 (u32), x 16, y 18, width 20, height 22 (u16)
        self.assertEqual(h[0:2], b"LB")
        self.assertEqual(list(h[2:6]), [1, 0x20, 2, 0x01])
        self.assertEqual(h[6:8], b"\0\0")
        self.assertEqual(int.from_bytes(h[8:12], "little"), 5)        # seq는 32 bit로 잘림
        self.assertEqual(int.from_bytes(h[12:16], "little"), 0x1234)
        self.assertEqual([int.from_bytes(h[i:i + 2], "little") for i in (16, 18, 20, 22)], [3, 4, 5, 6])

    def test_parse_roundtrip(self):
        msg = proto.image_msg("png", 7, b"\x89PNG")
        p = proto.parse_header(msg)
        self.assertEqual((p["type"], p["format"], p["seq"], p["payload"]), (proto.T_IMAGE, 2, 7, b"\x89PNG"))

    def test_parse_rejects_bad_magic_and_short(self):
        self.assertIsNone(proto.parse_header(b"XX" + bytes(22)))
        self.assertIsNone(proto.parse_header(b"LB"))


class LedTest(unittest.TestCase):
    def roundtrip(self, fmt, w, h, values):
        msg = proto.led_msg(fmt, 0, values, 0, 0, w, h)
        p = proto.parse_header(msg)
        bits = proto.LED_FMT[fmt][1]
        self.assertEqual(len(p["payload"]), ((w * bits + 7) // 8) * h)   # 행마다 바이트 정렬
        return proto.unpack_led(p["payload"], w, h, bits)

    def test_l8_exact(self):
        vals = list(range(0, 256, 17)) * 2
        self.assertEqual(self.roundtrip("l8", 8, 4, vals), vals)

    def test_l4_odd_width(self):
        w, h = 5, 3
        vals = [(i * 37) % 256 for i in range(w * h)]
        self.assertEqual(self.roundtrip("l4", w, h, vals), [(v // 17) * 17 for v in vals])

    def test_l1_odd_width(self):
        w, h = 11, 2
        vals = [(i * 53) % 256 for i in range(w * h)]
        self.assertEqual(self.roundtrip("l1", w, h, vals), [255 if v >= 128 else 0 for v in vals])

    def test_l1_msb_is_left(self):
        payload = proto.pack_led([255, 0, 0, 0, 0, 0, 0, 255], 8, 1)
        self.assertEqual(payload, b"\x81")

    def test_flags_and_region(self):
        p = proto.parse_header(proto.led_msg("l8", 1, [0] * 6, 2, 3, 3, 2, flags=proto.F_CLEAR))
        self.assertEqual((p["flags"], p["x"], p["y"], p["width"], p["height"]), (proto.F_CLEAR, 2, 3, 3, 2))

    def test_value_count_mismatch(self):
        with self.assertRaises(ValueError):
            proto.led_msg("l8", 0, [0] * 5, 0, 0, 3, 2)


class RawTest(unittest.TestCase):
    def test_raw(self):
        p = proto.parse_header(proto.raw_msg("rgb24", 0, 2, 1, bytes(6)))
        self.assertEqual((p["type"], p["format"], p["width"], p["height"]), (proto.T_RAW, 2, 2, 1))

    def test_length_mismatch(self):
        with self.assertRaises(ValueError):
            proto.raw_msg("rgba32", 0, 2, 2, bytes(15))


class RuleTest(unittest.TestCase):
    def test_hint(self):
        self.assertEqual(proto.hint_from_board(96, 48), (768, 384))
        self.assertEqual(proto.hint_from_board(320, 180), (1920, 1080))

    def test_sim_url(self):
        u = proto.sim_url("0.0.0.0", 8765)
        self.assertTrue(u.startswith("file:///") and u.endswith("index.html?ws=ws://127.0.0.1:8765/"))


if __name__ == "__main__":
    unittest.main()
