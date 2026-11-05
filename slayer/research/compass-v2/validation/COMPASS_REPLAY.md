# Simulator validation against recorded Compass calls

Calls with a recorded fill and exit: 39 (2026-10-29: 10, 2026-11-04: 29); quotes found for 39.

- Recorded fill bid/ask == terminal 100 ms NBBO in force at the fill instant: **39/39**
- Recorded exit price == terminal bid in force at the exit instant: **35/39**; the other 4 are take-profits booked at the resting 1.50x limit, and the bid in force was at or through that limit in 4/4 (so every recorded exit is consistent with the tape: 39/39)
- Engine replay (Compass timing: decision at the mark, the recorded fill delay, exit order arriving at the recorded exit time) reproduces the recorded entry ask and exit bid: **35/39** (the rest are the take-profit limits above: the engine sells at the bid, 4 of them at or above the limit)
- Minute cache (nov4data) board at the fill minute == our quote in force at the minute START: 39/39; at the minute END: 2/39

**Protocol execution (2 s after the mark, at the ask, displayed size) vs the Compass paper fill (ask one minute after the mark):**
- entry price ratio 2s-fill / paper-fill: median +0.96%, mean +1.77%, range [-19.4%, +29.1%]
- mean gross return per call: paper -2.21%, 2-second execution -2.40%
- displayed ask size at the 2 s fill: median 17, min 1

**Mismatches**

| call | fill_at | rec_bid_ask | tape_bid_ask | exit_at | rec_exit | tape_exit_bid | why |
|---|---|---|---|---|---|---|---|
| 20261104 A AAPL 347.50C exp 20261104 | 09:46:00 | 3.85/3.95 | 3.85/3.95 | 10:04:04 | 5.930 | 5.950 | Take profit 1.50× |
| 20261104 A IWM 287P exp 20261105 | 09:51:00 | 2.91/2.94 | 2.91/2.94 | 10:21:51 | 4.410 | 4.470 | Take profit 1.50× |
| 20261104 A GLD 368C exp 20261104 | 09:56:00 | 2.15/2.24 | 2.15/2.24 | 11:38:27 | 3.360 | 3.450 | Take profit 1.50× |
| 20261104 A NDXP 28440C exp 20261104 | 09:56:00 | 229.00/240.40 | 229.00/240.40 | 10:14:16 | 360.600 | 364.600 | Take profit 1.50× |

**Every call**

| call | fill_at | rec_bid_ask | tape_bid_ask | fill_match | exit_at | rec_exit | tape_exit_bid | exit_match | why | tp_limit_ok | eng_entry | eng_exit | eng_match | p2_entry | p2_ask_size | p2_exit | p2_ret_gross | rec_ret_gross | match_min_start | match_min_end |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 20261029 C IWM 283C exp 20261029 | 15:21:00 | 0.41/0.42 | 0.41/0.42 | True | 15:50:00 | 0.440 | 0.440 | True | 15:50 flat | False | 0.420 | 0.440 | True | 0.420 | 109 | 0.480 | 0.143 | 0.048 | True | False |
| 20261029 C QQQ 713P exp 20261029 | 15:21:00 | 1.51/1.53 | 1.51/1.53 | True | 15:50:00 | 1.090 | 1.090 | True | 15:50 flat | False | 1.530 | 1.090 | True | 1.580 | 38 | 1.090 | -0.310 | -0.288 | True | False |
| 20261029 C SPY 768C exp 20261029 | 15:21:00 | 1.06/1.07 | 1.06/1.07 | True | 15:50:00 | 1.320 | 1.320 | True | 15:50 flat | False | 1.070 | 1.320 | True | 1.060 | 254 | 1.320 | 0.245 | 0.234 | True | False |
| 20261029 C XSP 770C exp 20261029 | 15:21:00 | 0.65/0.69 | 0.65/0.69 | True | 15:50:00 | 1.000 | 1.000 | True | 15:50 flat | False | 0.690 | 1.000 | True | 0.670 | 32 | 1.000 | 0.493 | 0.449 | True | False |
| 20261029 C SPXW 7715C exp 20261029 | 15:21:00 | 0.80/0.85 | 0.80/0.85 | True | 15:50:00 | 1.200 | 1.200 | True | 15:50 flat | False | 0.850 | 1.200 | True | 0.800 | 126 | 1.200 | 0.500 | 0.412 | True | True |
| 20261029 A QQQ 719P exp 20261030 | 09:46:00 | 6.53/6.57 | 6.53/6.57 | True | 10:01:00 | 6.210 | 6.210 | True | Get out. Small loss. The stock reversed  | False | 6.570 | 6.210 | True | 6.690 | 8 | 6.210 | -0.072 | -0.055 | True | False |
| 20261029 A GLD 368C exp 20261029 | 09:46:00 | 1.56/1.64 | 1.56/1.64 | True | 10:49:00 | 1.590 | 1.590 | True | Stop | False | 1.640 | 1.590 | True | 1.480 | 5 | 1.590 | 0.074 | -0.030 | True | False |
| 20261029 A NDXP 29430P exp 20261029 | 09:46:00 | 113.40/123.00 | 113.40/123.00 | True | 09:59:00 | 115.200 | 115.200 | True | Stop | False | 123.000 | 115.200 | True | 126.400 | 28 | 115.200 | -0.089 | -0.063 | True | False |
| 20261029 A XSP 772P exp 20261029 | 09:46:00 | 1.75/1.78 | 1.75/1.78 | True | 10:01:00 | 1.710 | 1.710 | True | Stop | False | 1.780 | 1.710 | True | 1.990 | 10 | 1.710 | -0.141 | -0.039 | True | False |
| 20261029 A MSFT 532.50P exp 20261030 | 09:41:00 | 6.05/6.55 | 6.05/6.55 | True | 09:42:00 | 4.750 | 4.750 | True | Get out. The stock reversed over the las | False | 6.550 | 4.750 | True | 6.950 | 1 | 4.750 | -0.317 | -0.275 | True | False |
| 20261104 A AAPL 347.50C exp 20261106 | 09:46:00 | 5.45/5.70 | 5.45/5.70 | True | 10:10:00 | 6.250 | 6.250 | True | Get out early. The stock reversed over t | False | 5.700 | 6.250 | True | 5.950 | 65 | 6.250 | 0.050 | 0.096 | True | False |
| 20261104 A MSFT 545C exp 20261106 | 09:46:00 | 9.30/9.85 | 9.30/9.85 | True | 10:07:00 | 11.500 | 11.500 | True | Get out early. The stock reversed over t | False | 9.850 | 11.500 | True | 9.650 | 40 | 11.500 | 0.192 | 0.168 | True | False |
| 20261104 A META 642.50P exp 20261106 | 09:46:00 | 16.70/16.95 | 16.70/16.95 | True | 10:09:00 | 14.450 | 14.450 | True | Get out. Small loss. The stock reversed  | False | 16.950 | 14.450 | True | 17.400 | 1 | 14.450 | -0.170 | -0.147 | True | False |
| 20261104 A AAPL 347.50C exp 20261104 | 09:46:00 | 3.85/3.95 | 3.85/3.95 | True | 10:04:04 | 5.930 | 5.950 | False | Take profit 1.50× | True | 3.950 | 5.950 | False | 4.150 | 101 | 5.950 | 0.434 | 0.501 | True | False |
| 20261104 A IWM 285C exp 20261104 | 09:46:00 | 1.45/1.47 | 1.45/1.47 | True | 09:54:03 | 0.680 | 0.680 | True | Stop | False | 1.470 | 0.680 | True | 1.590 | 9 | 0.680 | -0.572 | -0.537 | True | False |
| 20261104 A QQQ 694C exp 20261104 | 09:46:00 | 5.18/5.22 | 5.18/5.22 | True | 10:23:39 | 5.220 | 5.220 | True | Stop | False | 5.220 | 5.220 | True | 5.610 | 14 | 5.220 | -0.070 | 0.000 | True | False |
| 20261104 A SPY 765C exp 20261104 | 09:46:00 | 3.61/3.62 | 3.61/3.62 | True | 11:22:03 | 1.680 | 1.680 | True | Stop | False | 3.620 | 1.680 | True | 3.850 | 47 | 1.680 | -0.564 | -0.536 | True | False |
| 20261104 A SPXW 7680C exp 20261104 | 09:46:00 | 31.60/31.80 | 31.60/31.80 | True | 10:51:53 | 14.800 | 14.800 | True | Stop | False | 31.800 | 14.800 | True | 34.000 | 5 | 14.800 | -0.565 | -0.535 | True | False |
| 20261104 A IWM 287P exp 20261105 | 09:51:00 | 2.91/2.94 | 2.91/2.94 | True | 10:21:51 | 4.410 | 4.470 | False | Take profit 1.50× | True | 2.940 | 4.470 | False | 2.800 | 6 | 4.470 | 0.596 | 0.500 | True | False |
| 20261104 A NVDA 202.50C exp 20261106 | 09:51:00 | 5.20/5.25 | 5.20/5.25 | True | 09:52:00 | 5.050 | 5.050 | True | Get out. Small loss. The stock reversed  | False | 5.250 | 5.050 | True | 5.150 | 83 | 5.050 | -0.019 | -0.038 | True | False |
| 20261104 A TQQQ 63C exp 20261104 | 09:51:00 | 1.12/1.18 | 1.12/1.18 | True | 09:52:00 | 1.100 | 1.100 | True | Get out. Small loss. The stock reversed  | False | 1.180 | 1.100 | True | 1.350 | 275 | 1.100 | -0.185 | -0.068 | True | False |
| 20261104 A NVDA 202.50C exp 20261104 | 09:51:00 | 3.55/3.60 | 3.55/3.60 | True | 09:52:00 | 3.300 | 3.300 | True | Get out. Small loss. The stock reversed  | False | 3.600 | 3.300 | True | 3.450 | 21 | 3.300 | -0.043 | -0.083 | True | False |
| 20261104 A META 640P exp 20261104 | 09:51:00 | 10.15/10.30 | 10.15/10.30 | True | 10:09:00 | 8.100 | 8.100 | True | Get out. The stock reversed over the las | False | 10.300 | 8.100 | True | 10.350 | 6 | 8.100 | -0.217 | -0.214 | True | False |
| 20261104 A GOOGL 287.50C exp 20261104 | 09:51:00 | 2.61/2.73 | 2.61/2.73 | True | 09:57:37 | 4.100 | 4.100 | True | Take profit 1.50× | True | 2.730 | 4.100 | True | 3.250 | 89 | 4.100 | 0.262 | 0.502 | True | False |
| 20261104 A XSP 767C exp 20261104 | 09:51:00 | 3.32/3.37 | 3.32/3.37 | True | 10:18:01 | 2.730 | 2.730 | True | Stop | False | 3.370 | 2.730 | True | 3.610 | 20 | 2.730 | -0.244 | -0.190 | True | False |
| 20261104 A AMZN 262.50C exp 20261106 | 09:56:00 | 8.70/8.95 | 8.70/8.95 | True | 10:12:00 | 8.300 | 8.300 | True | Get out. Small loss. The stock reversed  | False | 8.950 | 8.300 | True | 8.200 | 83 | 8.300 | 0.012 | -0.073 | True | False |
| 20261104 A XSP 765C exp 20261105 | 09:56:00 | 5.78/5.97 | 5.78/5.97 | True | 15:55:00 | 4.710 | 4.710 | True | 15:55 flat | False | 5.970 | 4.710 | True | 5.870 | 19 | 4.710 | -0.198 | -0.211 | True | False |
| 20261104 A QQQ 692C exp 20261105 | 09:56:00 | 7.59/7.64 | 7.59/7.64 | True | 10:26:00 | 7.690 | 7.690 | True | Get out early. The stock reversed over t | False | 7.640 | 7.690 | True | 7.600 | 8 | 7.690 | 0.012 | 0.007 | True | False |
| 20261104 A SPY 763C exp 20261105 | 09:56:00 | 5.56/5.58 | 5.56/5.58 | True | 15:55:00 | 4.520 | 4.520 | True | 15:55 flat | False | 5.580 | 4.520 | True | 5.490 | 17 | 4.520 | -0.177 | -0.190 | True | False |
| 20261104 A SPXW 7670C exp 20261105 | 09:56:00 | 44.30/44.60 | 44.30/44.60 | True | 13:41:46 | 44.500 | 44.500 | True | Stop | False | 44.600 | 44.500 | True | 44.000 | 5 | 44.500 | 0.011 | -0.002 | True | False |
| 20261104 A MU 815C exp 20261104 | 09:56:00 | 19.15/20.80 | 19.15/20.80 | True | 09:57:00 | 16.700 | 16.700 | True | Get out. The stock reversed over the las | False | 20.800 | 16.700 | True | 21.000 | 11 | 16.700 | -0.205 | -0.197 | True | False |
| 20261104 A MSFT 545C exp 20261104 | 09:56:00 | 7.75/8.15 | 7.75/8.15 | True | 10:07:00 | 9.000 | 9.000 | True | Get out early. The stock reversed over t | False | 8.150 | 9.000 | True | 7.400 | 14 | 9.000 | 0.216 | 0.104 | True | False |
| 20261104 A AMZN 267.50C exp 20261104 | 09:56:00 | 3.35/3.45 | 3.35/3.45 | True | 10:12:00 | 2.880 | 2.880 | True | Get out. The stock reversed over the las | False | 3.450 | 2.880 | True | 2.780 | 30 | 2.880 | 0.036 | -0.165 | True | False |
| 20261104 A AMD 492.50C exp 20261104 | 09:56:00 | 9.80/10.25 | 9.80/10.25 | True | 09:57:00 | 8.450 | 8.450 | True | Get out. The stock reversed over the las | False | 10.250 | 8.450 | True | 11.750 | 14 | 8.450 | -0.281 | -0.176 | True | False |
| 20261104 A GLD 368C exp 20261104 | 09:56:00 | 2.15/2.24 | 2.15/2.24 | True | 11:38:27 | 3.360 | 3.450 | False | Take profit 1.50× | True | 2.240 | 3.450 | False | 2.330 | 5 | 3.450 | 0.481 | 0.500 | True | False |
| 20261104 A RUTW 2860C exp 20261104 | 09:56:00 | 7.30/7.90 | 7.30/7.90 | True | 10:11:02 | 3.600 | 3.600 | True | Stop | False | 7.900 | 3.600 | True | 10.200 | 1 | 3.600 | -0.647 | -0.544 | True | False |
| 20261104 A NDXP 28440C exp 20261104 | 09:56:00 | 229.00/240.40 | 229.00/240.40 | True | 10:14:16 | 360.600 | 364.600 | False | Take profit 1.50× | True | 240.400 | 364.600 | False | 236.100 | 5 | 364.600 | 0.544 | 0.500 | True | False |
| 20261104 A AVGO 330C exp 20261104 | 10:01:00 | 3.95/4.10 | 3.95/4.10 | True | 10:22:00 | 2.470 | 2.470 | True | Get out. The stock reversed over the las | False | 4.100 | 2.470 | True | 3.550 | 1 | 2.470 | -0.304 | -0.398 | True | True |
| 20261104 A TSLA 380C exp 20261104 | 10:06:00 | 7.35/7.55 | 7.35/7.55 | True | 10:47:00 | 8.850 | 8.850 | True | Get out early. The stock reversed over t | False | 7.550 | 8.850 | True | 7.700 | 60 | 8.850 | 0.149 | 0.172 | True | False |
