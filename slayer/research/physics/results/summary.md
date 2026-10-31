# Primary tests (77), Holm-adjusted across all of them

p boot = day-block bootstrap (floors at 1/n); p Holm = Holm-Bonferroni on the normal-approximation p from the bootstrap CI.

| indicator | symbol | test | effect [95% CI] | unit | p boot | p Holm | survives |
|---|---|---|---|---|---|---|---|
| Permutation entropy | SPY | next-60m log RV, dR2 over intraday HAR | -0.00327 [-0.0293, +0.0219] | pp R2 | 0.817 | 1 |  |
| Sample entropy | SPY | next-60m log RV, dR2 over intraday HAR | +0.029 [-0.0108, +0.07] | pp R2 | 0.149 | 1 |  |
| Market Lyapunov | SPY | next-60m log RV, dR2 over intraday HAR | -0.00203 [-0.0074, +0.00398] | pp R2 | 0.507 | 1 |  |
| Phase sync R (vol) | SPY | next-60m log RV, dR2 over intraday HAR | +0.00147 [-0.02, +0.0237] | pp R2 | 0.901 | 1 |  |
| Viscosity (Amihud) | SPY | next-60m log RV, dR2 over HAR + rel. volume | +0.00143 [-0.083, +0.0862] | pp R2 | 0.994 | 1 |  |
| Viscosity (Kyle lambda) | SPY | next-60m log RV, dR2 over HAR + rel. volume | +0.0457 [-0.0264, +0.12] | pp R2 | 0.226 | 1 |  |
| DFA / Hurst persistence | SPY | momentum continuation, top-bottom tercile | -0.445 [-1.43, +0.543] | bps/30m | 0.418 | 1 |  |
| Permutation entropy (trend) | SPY | momentum continuation, top-bottom tercile | +0.26 [-0.722, +1.28] | bps/30m | 0.621 | 1 |  |
| Phase synchronization | SPY | next-30m return, top-bottom tercile | -0.467 [-1.54, +0.653] | bps/30m | 0.421 | 1 |  |
| Critical transition (AR1 rise) | SPY | large next-60m move, AUC gain over HAR | -0.000658 [-0.00161, +0.000278] | AUC | 0.182 | 1 |  |
| Escape velocity | SPY | breakout continuation, top-bottom tercile | -0.43 [-1.26, +0.407] | sigma/30m | 0.296 | 1 |  |
| Permutation entropy | QQQ | next-60m log RV, dR2 over intraday HAR | -0.00714 [-0.0303, +0.0158] | pp R2 | 0.564 | 1 |  |
| Sample entropy | QQQ | next-60m log RV, dR2 over intraday HAR | +0.00814 [-0.00829, +0.0247] | pp R2 | 0.319 | 1 |  |
| Market Lyapunov | QQQ | next-60m log RV, dR2 over intraday HAR | +0.0277 [-0.0294, +0.0847] | pp R2 | 0.337 | 1 |  |
| Phase sync R (vol) | QQQ | next-60m log RV, dR2 over intraday HAR | +0.00429 [-0.00691, +0.0158] | pp R2 | 0.456 | 1 |  |
| Viscosity (Amihud) | QQQ | next-60m log RV, dR2 over HAR + rel. volume | +0.0981 [-0.018, +0.215] | pp R2 | 0.087 | 1 |  |
| Viscosity (Kyle lambda) | QQQ | next-60m log RV, dR2 over HAR + rel. volume | +0.126 [+0.0304, +0.221] | pp R2 | 0.007 | 0.585 |  |
| DFA / Hurst persistence | QQQ | momentum continuation, top-bottom tercile | -0.567 [-1.81, +0.742] | bps/30m | 0.383 | 1 |  |
| Permutation entropy (trend) | QQQ | momentum continuation, top-bottom tercile | +0.562 [-0.714, +1.86] | bps/30m | 0.382 | 1 |  |
| Phase synchronization | QQQ | next-30m return, top-bottom tercile | -0.615 [-2.01, +0.842] | bps/30m | 0.428 | 1 |  |
| Critical transition (AR1 rise) | QQQ | large next-60m move, AUC gain over HAR | -0.000274 [-0.000773, +0.000183] | AUC | 0.240 | 1 |  |
| Escape velocity | QQQ | breakout continuation, top-bottom tercile | -0.382 [-1.2, +0.486] | sigma/30m | 0.397 | 1 |  |
| Permutation entropy | SPX | next-60m log RV, dR2 over intraday HAR | +0.135 [+0.061, +0.214] | pp R2 | 0.001 | 0.0345 | yes |
| Sample entropy | SPX | next-60m log RV, dR2 over intraday HAR | -0.0134 [-0.124, +0.0937] | pp R2 | 0.788 | 1 |  |
| Market Lyapunov | SPX | next-60m log RV, dR2 over intraday HAR | +0.042 [-0.0372, +0.124] | pp R2 | 0.299 | 1 |  |
| Phase sync R (vol) | SPX | next-60m log RV, dR2 over intraday HAR | -0.00434 [-0.0178, +0.00939] | pp R2 | 0.534 | 1 |  |
| DFA / Hurst persistence | SPX | momentum continuation, top-bottom tercile | -0.562 [-1.5, +0.392] | bps/30m | 0.249 | 1 |  |
| Permutation entropy (trend) | SPX | momentum continuation, top-bottom tercile | -0.149 [-1.21, +0.816] | bps/30m | 0.794 | 1 |  |
| Phase synchronization | SPX | next-30m return, top-bottom tercile | -0.498 [-1.61, +0.655] | bps/30m | 0.389 | 1 |  |
| Critical transition (AR1 rise) | SPX | large next-60m move, AUC gain over HAR | -0.00137 [-0.00312, +0.000208] | AUC | 0.102 | 1 |  |
| Permutation entropy | NVDA | next-60m log RV, dR2 over intraday HAR | -0.00504 [-0.0156, +0.00489] | pp R2 | 0.332 | 1 |  |
| Sample entropy | NVDA | next-60m log RV, dR2 over intraday HAR | +0.00675 [-0.0167, +0.0305] | pp R2 | 0.574 | 1 |  |
| Market Lyapunov | NVDA | next-60m log RV, dR2 over intraday HAR | +0.0165 [-0.0103, +0.0449] | pp R2 | 0.250 | 1 |  |
| Phase sync R (vol) | NVDA | next-60m log RV, dR2 over intraday HAR | +0.0678 [+0.0142, +0.121] | pp R2 | 0.015 | 0.739 |  |
| Viscosity (Amihud) | NVDA | next-60m log RV, dR2 over HAR + rel. volume | +0.0516 [+0.0201, +0.0859] | pp R2 | 0.002 | 0.135 |  |
| Viscosity (Kyle lambda) | NVDA | next-60m log RV, dR2 over HAR + rel. volume | +0.0337 [+0.00797, +0.0604] | pp R2 | 0.009 | 0.664 |  |
| DFA / Hurst persistence | NVDA | momentum continuation, top-bottom tercile | -1.97 [-4.29, +0.47] | bps/30m | 0.108 | 1 |  |
| Permutation entropy (trend) | NVDA | momentum continuation, top-bottom tercile | +0.644 [-1.85, +3.14] | bps/30m | 0.636 | 1 |  |
| Phase synchronization | NVDA | next-30m return, top-bottom tercile | -0.831 [-3.69, +2.27] | bps/30m | 0.596 | 1 |  |
| Critical transition (AR1 rise) | NVDA | large next-60m move, AUC gain over HAR | +2.52e-05 [-0.00079, +0.000841] | AUC | 0.942 | 1 |  |
| Escape velocity | NVDA | breakout continuation, top-bottom tercile | +0.493 [-0.247, +1.33] | sigma/30m | 0.218 | 1 |  |
| Permutation entropy | AAPL | next-60m log RV, dR2 over intraday HAR | -0.0173 [-0.0403, +0.00306] | pp R2 | 0.104 | 1 |  |
| Sample entropy | AAPL | next-60m log RV, dR2 over intraday HAR | +0.0492 [-0.00212, +0.105] | pp R2 | 0.064 | 1 |  |
| Market Lyapunov | AAPL | next-60m log RV, dR2 over intraday HAR | -0.000673 [-0.016, +0.0144] | pp R2 | 0.921 | 1 |  |
| Phase sync R (vol) | AAPL | next-60m log RV, dR2 over intraday HAR | -0.000905 [-0.0139, +0.0122] | pp R2 | 0.897 | 1 |  |
| Viscosity (Amihud) | AAPL | next-60m log RV, dR2 over HAR + rel. volume | -0.0187 [-0.0612, +0.0249] | pp R2 | 0.395 | 1 |  |
| Viscosity (Kyle lambda) | AAPL | next-60m log RV, dR2 over HAR + rel. volume | +0.00881 [-0.0238, +0.0429] | pp R2 | 0.578 | 1 |  |
| DFA / Hurst persistence | AAPL | momentum continuation, top-bottom tercile | +0.668 [-0.866, +2.18] | bps/30m | 0.402 | 1 |  |
| Permutation entropy (trend) | AAPL | momentum continuation, top-bottom tercile | -1.04 [-2.46, +0.323] | bps/30m | 0.142 | 1 |  |
| Phase synchronization | AAPL | next-30m return, top-bottom tercile | +0.266 [-1.58, +2.2] | bps/30m | 0.811 | 1 |  |
| Critical transition (AR1 rise) | AAPL | large next-60m move, AUC gain over HAR | -0.000667 [-0.00708, +0.0058] | AUC | 0.850 | 1 |  |
| Escape velocity | AAPL | breakout continuation, top-bottom tercile | +0.324 [-0.301, +1] | sigma/30m | 0.301 | 1 |  |
| Grav. wave scanner (vol spillover) | QQQ->SPY | next-60m log RV, dR2 over own HAR | +0.0468 [-0.0189, +0.109] | pp R2 | 0.168 | 1 |  |
| Grav. wave scanner (vol spillover) | NVDA->SPY | next-60m log RV, dR2 over own HAR | +0.147 [+0.0308, +0.255] | pp R2 | 0.007 | 0.6 |  |
| Grav. wave scanner (vol spillover) | SPY->QQQ | next-60m log RV, dR2 over own HAR | +0.11 [+0.0102, +0.215] | pp R2 | 0.032 | 1 |  |
| Grav. wave scanner (vol spillover) | NVDA->QQQ | next-60m log RV, dR2 over own HAR | +0.185 [+0.0695, +0.301] | pp R2 | 0.003 | 0.111 |  |
| Grav. wave scanner (vol spillover) | SPY->NVDA | next-60m log RV, dR2 over own HAR | +0.165 [+0.0616, +0.265] | pp R2 | 0.001 | 0.091 |  |
| Grav. wave scanner (vol spillover) | QQQ->NVDA | next-60m log RV, dR2 over own HAR | +0.131 [+0.0276, +0.226] | pp R2 | 0.015 | 0.585 |  |
| Grav. wave scanner (vol spillover) | SPY->AAPL | next-60m log RV, dR2 over own HAR | +1.04 [+0.713, +1.38] | pp R2 | 0.001 | 6.88e-08 | yes |
| Grav. wave scanner (vol spillover) | QQQ->AAPL | next-60m log RV, dR2 over own HAR | +0.866 [+0.541, +1.19] | pp R2 | 0.001 | 1.19e-05 | yes |
| Grav. wave scanner (vol spillover) | NVDA->AAPL | next-60m log RV, dR2 over own HAR | +0.616 [+0.311, +0.921] | pp R2 | 0.001 | 0.00508 | yes |
| Vol half-life (AR1) | SPY | next-day log RV, MSE cut vs 20-day RV | +33.4 [+19.2, +50.9] | % MSE | 0.001 | 0.0025 | yes |
| Vol half-life (HAR) | SPY | next-day log RV, MSE cut vs 20-day RV | +35.8 [+22, +53.4] | % MSE | 0.001 | 0.000573 | yes |
| Vol half-life (AR1) | QQQ | next-day log RV, MSE cut vs 20-day RV | +28.3 [+15.7, +43.6] | % MSE | 0.001 | 0.00508 | yes |
| Vol half-life (HAR) | QQQ | next-day log RV, MSE cut vs 20-day RV | +32.1 [+20, +47.8] | % MSE | 0.001 | 0.000474 | yes |
| Vol half-life (AR1) | SPX | next-day log RV, MSE cut vs 20-day RV | +32.6 [+18.4, +49.9] | % MSE | 0.001 | 0.00336 | yes |
| Vol half-life (HAR) | SPX | next-day log RV, MSE cut vs 20-day RV | +35.4 [+21.7, +52.8] | % MSE | 0.001 | 0.000574 | yes |
| Vol half-life (AR1) | NVDA | next-day log RV, MSE cut vs 20-day RV | +8.69 [-5.71, +26.7] | % MSE | 0.246 | 1 |  |
| Vol half-life (HAR) | NVDA | next-day log RV, MSE cut vs 20-day RV | +20.8 [+9.26, +36.4] | % MSE | 0.001 | 0.162 |  |
| Vol half-life (AR1) | AAPL | next-day log RV, MSE cut vs 20-day RV | +19.4 [+5.59, +38.6] | % MSE | 0.001 | 1 |  |
| Vol half-life (HAR) | AAPL | next-day log RV, MSE cut vs 20-day RV | +25.1 [+10.9, +45.6] | % MSE | 0.001 | 0.281 |  |
| Gravity well (pin to max-gamma strike) | SPY | close distance to well minus to mirror strike | +0.072 [+0.00769, +0.141] | % of spot | 0.036 | 1 |  |
| Net dealer gamma (vol) | SPY | day log RV, dR2 over daily HAR + VIX | +3.66 [+2.16, +5.22] | pp R2 | 0.001 | 0.000198 | yes |
| Gravity pull direction | SPY | open-to-close return, top-bottom tercile | -14.5 [-33.9, +4.36] | bps/day | 0.124 | 1 |  |
| Gravity well (pin to max-gamma strike) | QQQ | close distance to well minus to mirror strike | +0.037 [-0.0455, +0.127] | % of spot | 0.405 | 1 |  |
| Net dealer gamma (vol) | QQQ | day log RV, dR2 over daily HAR + VIX | +4.87 [+3.37, +6.32] | pp R2 | 0.001 | 8.11e-09 | yes |
| Gravity pull direction | QQQ | open-to-close return, top-bottom tercile | -12.3 [-34.8, +9.13] | bps/day | 0.276 | 1 |  |
