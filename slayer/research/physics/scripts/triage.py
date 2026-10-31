"""Write results/indicator_triage.csv: a one-word verdict for each of the 200 proposed indicators.

The proposal named the ten families, their headline ideas and a shortlist of 15; the 200 are reconstructed as
20 per family from those descriptions. Verdicts:
  KEEP     build it (or keep it as a tested input) -- established method, computable, earned it in the tests or is
           a standard display with a clear use
  MERGE    same thing as an existing Slayer read or as another row (named in standard_name); ship once, under the
           plain name
  RESEARCH computable from our data and plausibly useful, not yet tested or tested inconclusively
  DROP     metaphor without a computable definition, a duplicate of a duplicate, or needs data we do not have
Data codes: 1m = 1-minute OHLCV bars; D = daily; OPT = option chain / OI / greeks (ThetaData); X = several assets;
L2 = order-book depth (UNAVAILABLE); TAPE = signed trade tape (stock trades exist on ThetaData, untested here).
Pages: Terrain (chart + strike rail), Compass (options-call engine; 'Compass-retrain' = candidate input for a future
retrain only), Pulse (tiles), Weigher (chain / book at a strike), Pinpoint, Trace, none.
"""
import csv, os
from lib import RESULTS

F = {
 'EM': 'electromagnetism', 'FL': 'fluid dynamics', 'TH': 'thermodynamics', 'WV': 'wave physics',
 'CM': 'classical mechanics', 'CH': 'chaos', 'QU': 'quantum-inspired', 'OP': 'optics',
 'SM': 'statistical mechanics', 'AS': 'astrophysics'}

R = [
 # ---- electromagnetism
 ('EM', 'Flux Field', 'MERGE', 'signed volume profile / order-flow imbalance (OFI)', '1m', 'Terrain'),
 ('EM', 'Field Gradient', 'MERGE', 'slope of the per-strike gamma profile (dGEX/dK); Terrain strike rail', 'OPT', 'Terrain'),
 ('EM', 'Polarity', 'MERGE', 'put/call volume or premium ratio; net premium sign', 'OPT', 'Trace'),
 ('EM', 'Equilibrium', 'MERGE', 'VWAP / volume point-of-control / gamma flip (all exist)', '1m+OPT', 'Terrain'),
 ('EM', 'Charge Density', 'MERGE', 'open interest by strike (exists)', 'OPT', 'Weigher'),
 ('EM', 'Magnetic Pull', 'DROP', 'strike pinning (tested as Gravity Well: no attraction)', 'OPT+1m', 'none'),
 ('EM', 'Induction', 'DROP', 'volume-volatility correlation (no new information)', '1m', 'none'),
 ('EM', 'Capacitance', 'RESEARCH', 'gamma/charm roll-off into expiry (OPEX unclenching)', 'OPT', 'Pinpoint'),
 ('EM', 'Resistance (Ohm)', 'MERGE', "Kyle's lambda (tested as Viscosity)", '1m', 'Pulse'),
 ('EM', 'Current', 'MERGE', 'signed volume per minute (OFI)', '1m', 'Terrain'),
 ('EM', 'Voltage', 'MERGE', 'VWAP z-score (Compass input already)', '1m', 'Compass'),
 ('EM', 'Field Lines', 'DROP', 'visual metaphor only', '-', 'none'),
 ('EM', 'Dipole Moment', 'RESEARCH', 'call-wall minus put-wall distance vs the implied move', 'OPT', 'Pinpoint'),
 ('EM', 'Lorentz Force', 'DROP', 'no computable definition', '-', 'none'),
 ('EM', 'Electric Potential Map', 'MERGE', 'integrated gamma profile = Potential Energy Map row', 'OPT', 'none'),
 ('EM', 'Coulomb Repulsion', 'DROP', 'contradicts its own sibling (pull); same data as walls', 'OPT', 'none'),
 ('EM', 'Faraday Shock', 'MERGE', 'OI change z-score by strike (book/oiChange exists)', 'OPT', 'Pinpoint'),
 ('EM', 'Conductivity', 'MERGE', 'inverse Amihud illiquidity', '1m', 'Pulse'),
 ('EM', 'Shielding', 'RESEARCH', 'net/gross gamma ratio (how much of the book offsets)', 'OPT', 'Pinpoint'),
 ('EM', 'Field Strength Index', 'DROP', 'composite of the rows above', '-', 'none'),
 # ---- fluid dynamics
 ('FL', 'Order-Flow Velocity', 'MERGE', 'order-flow imbalance rate (OFI)', '1m/TAPE', 'Terrain'),
 ('FL', 'Viscosity', 'RESEARCH', 'Amihud illiquidity / Kyle lambda on 1-min bars (tested: ~0 beyond relative volume; display-only for single names)', '1m', 'Weigher'),
 ('FL', 'Turbulence', 'RESEARCH', 'Kritzman-Li turbulence (Mahalanobis distance of cross-asset returns)', 'X', 'Pulse'),
 ('FL', 'Reynolds Regime', 'MERGE', 'trend-to-noise ratio = Kaufman efficiency ratio', '1m', 'Pulse'),
 ('FL', 'Vortex Detector', 'MERGE', 'Vortex Indicator (Botes-Siepman) / short-horizon reversal', '1m', 'Terrain'),
 ('FL', 'Eddy Reversal', 'MERGE', 'short-horizon mean reversion (duplicate of Vortex)', '1m', 'none'),
 ('FL', 'Laminar/Turbulent State', 'MERGE', 'regime label from vol level + efficiency ratio', '1m', 'Pulse'),
 ('FL', 'Pressure Gradient', 'RESEARCH', 'NBBO size imbalance (quote imbalance); full depth is L2 = UNAVAILABLE', 'quotes', 'Terrain'),
 ('FL', 'Bernoulli Effect', 'DROP', 'no computable definition', '-', 'none'),
 ('FL', 'Drag Coefficient', 'MERGE', 'slippage per unit volume (Viscosity)', '1m', 'none'),
 ('FL', 'Flow Divergence', 'MERGE', 'OBV / volume-price divergence', '1m', 'Terrain'),
 ('FL', 'Laminar Trend Score', 'MERGE', 'R^2 of a linear fit to price (efficiency ratio)', '1m', 'none'),
 ('FL', 'Boundary Layer', 'MERGE', 'behaviour at a level = wall back-test (docs/wall-backtest.md)', 'OPT+1m', 'Pinpoint'),
 ('FL', 'Liquidity Vortex', 'MERGE', 'repeated tests of a level; wall back-test found re-tests add ~nothing', 'OPT+1m', 'none'),
 ('FL', 'Flow Compressibility', 'MERGE', 'price elasticity to volume (Kyle lambda)', '1m', 'none'),
 ('FL', 'Wake', 'RESEARCH', 'post-block-trade drift (needs the trade tape)', 'TAPE', 'Trace'),
 ('FL', 'Cavitation', 'MERGE', 'low-volume nodes of the volume profile', '1m', 'Terrain'),
 ('FL', 'Stream Function', 'DROP', 'no computable definition', '-', 'none'),
 ('FL', 'Kolmogorov Spectrum', 'MERGE', 'multiscale variance scaling (Hurst / DFA)', '1m', 'none'),
 ('FL', 'Momentum Flux', 'DROP', 'volume-weighted momentum (duplicate)', '1m', 'none'),
 # ---- thermodynamics
 ('TH', 'Market Entropy', 'MERGE', 'Shannon entropy of binned returns -> permutation entropy row', '1m', 'none'),
 ('TH', 'Permutation Entropy', 'DROP', 'Bandt-Pompe permutation entropy (tested: no vol gain on 4 of 5 names, no direction)', '1m', 'none'),
 ('TH', 'Volatility Temperature', 'MERGE', 'realised volatility (exists)', '1m', 'Terrain'),
 ('TH', 'Phase Transition', 'RESEARCH', 'Markov-switching / HMM regime probability', 'D/1m', 'Pulse'),
 ('TH', 'Volatility Half-Life', 'KEEP', 'AR(1)/HAR mean-reversion half-life of realised vol (tested)', '1m->D', 'Pulse'),
 ('TH', 'Kinetic Energy', 'MERGE', 'volume x squared return ~ realised variance', '1m', 'none'),
 ('TH', 'Potential Energy Map', 'KEEP', 'dealer hedging potential = integrated gamma profile; its curvature at spot is net dealer gamma (tested: +3.7pp R2 on the day RV over HAR+VIX)', 'OPT', 'Terrain'),
 ('TH', 'Heat Capacity', 'DROP', 'no stable definition', '-', 'none'),
 ('TH', 'Free Energy', 'DROP', 'no computable definition', '-', 'none'),
 ('TH', 'Enthalpy', 'DROP', 'no computable definition', '-', 'none'),
 ('TH', 'Thermal Equilibrium', 'KEEP', 'implied-minus-realised vol spread (variance risk premium)', 'OPT+1m', 'Weigher'),
 ('TH', 'Heat Flow', 'MERGE', 'volatility spillover (Gravitational Wave Scanner row)', 'X', 'none'),
 ('TH', 'Boiling Point', 'DROP', 'arbitrary vol thresholds', 'D', 'none'),
 ('TH', 'Latent Heat', 'MERGE', 'volume absorbed without range (inverse Amihud)', '1m', 'none'),
 ('TH', 'Carnot Efficiency', 'MERGE', 'Kaufman efficiency ratio', '1m', 'none'),
 ('TH', 'Pressure', 'DROP', 'no computable definition', '-', 'none'),
 ('TH', 'Equation of State', 'DROP', 'no computable definition', '-', 'none'),
 ('TH', 'Sample Entropy', 'MERGE', 'Richman-Moorman sample entropy (tested beside permutation entropy)', '1m', 'none'),
 ('TH', 'Thermal Noise Floor', 'RESEARCH', 'microstructure-noise variance (volatility signature plot, Zhang-Mykland-Ait-Sahalia)', '1m/quotes', 'none'),
 ('TH', 'Cooling Rate', 'MERGE', 'vol decay after a spike = half-life row', '1m', 'none'),
 # ---- wave physics
 ('WV', 'Frequency Spectrum', 'DROP', 'periodogram of returns: white apart from intraday seasonality', '1m', 'none'),
 ('WV', 'Spectral Momentum', 'MERGE', 'low-frequency power / multi-horizon momentum', '1m', 'none'),
 ('WV', 'Wavelet Decomposition', 'RESEARCH', 'MODWT multiresolution (denoising tool, not a signal)', '1m', 'none'),
 ('WV', 'Phase Synchronization', 'DROP', 'Hilbert phase locking across timeframes (tested: no edge over plain sign agreement)', '1m', 'none'),
 ('WV', 'Wave Interference', 'MERGE', 'sum of cycle components = phase synchronisation row', '1m', 'none'),
 ('WV', 'Dominant Cycle', 'DROP', 'Ehlers dominant cycle; returns have no stable cycle', '1m', 'none'),
 ('WV', 'Amplitude', 'MERGE', 'range / ATR', '1m', 'none'),
 ('WV', 'Standing Waves', 'MERGE', 'range-bound regime label', '1m', 'Pulse'),
 ('WV', 'Resonance', 'RESEARCH', 'OPEX / calendar effects on vol and pinning', 'OPT+D', 'Pinpoint'),
 ('WV', 'Doppler Shift', 'DROP', 'no computable definition', '-', 'none'),
 ('WV', 'Harmonics', 'DROP', 'no computable definition', '-', 'none'),
 ('WV', 'Wave Packet', 'DROP', 'no computable definition', '-', 'none'),
 ('WV', 'Damping Ratio', 'MERGE', 'AR(2) damping = half-life row', '1m', 'none'),
 ('WV', 'Beat Frequency', 'DROP', 'no computable definition', '-', 'none'),
 ('WV', 'Group Velocity', 'DROP', 'no computable definition', '-', 'none'),
 ('WV', 'Wavelet Coherence', 'RESEARCH', 'wavelet coherence between two assets (Torrence-Compo)', 'X', 'none'),
 ('WV', 'Hilbert Phase', 'MERGE', 'phase synchronisation row', '1m', 'none'),
 ('WV', 'Spectral Entropy', 'MERGE', 'entropy row', '1m', 'none'),
 ('WV', 'Fourier Forecast', 'DROP', 'extrapolating a non-stationary spectrum: classic overfit', '1m', 'none'),
 ('WV', 'Cross-Timeframe Alignment', 'MERGE', 'plain multi-horizon momentum sign agreement (the phase test baseline; no edge either)', '1m', 'Terrain'),
 # ---- classical mechanics
 ('CM', 'Inertia', 'MERGE', 'return autocorrelation / Hurst', '1m', 'none'),
 ('CM', 'Impulse', 'MERGE', 'volume-weighted return burst', '1m', 'none'),
 ('CM', 'Escape Velocity', 'DROP', 'range-compression breakout strength (tested: no continuation; size signal = the breakout bar alone; Compass has range compression + OR break)', '1m', 'none'),
 ('CM', 'Elastic Reversion', 'MERGE', 'Ornstein-Uhlenbeck reversion to VWAP (VWAP z, Compass input)', '1m', 'Compass'),
 ('CM', 'Rebound Coefficient', 'MERGE', 'bounce ratio at a wall = wall back-test', 'OPT+1m', 'Pinpoint'),
 ('CM', 'Friction', 'MERGE', 'bid-ask spread / trading cost (spread/mid is a Compass input)', 'quotes', 'Compass'),
 ('CM', 'Momentum (p = m v)', 'MERGE', 'volume x return', '1m', 'none'),
 ('CM', 'Acceleration', 'DROP', 'second difference of price: noise', '1m', 'none'),
 ('CM', 'Jerk', 'DROP', 'third difference: noise', '1m', 'none'),
 ('CM', 'Centripetal Force', 'DROP', 'no computable definition', '-', 'none'),
 ('CM', 'Torque', 'DROP', 'no computable definition', '-', 'none'),
 ('CM', 'Angular Momentum', 'DROP', 'no computable definition', '-', 'none'),
 ('CM', 'Work Done', 'MERGE', 'move x volume', '1m', 'none'),
 ('CM', 'Power', 'DROP', 'no computable definition', '-', 'none'),
 ('CM', 'Projectile Target', 'DROP', 'measured-move folklore', '1m', 'none'),
 ('CM', 'Spring Constant', 'MERGE', 'OU mean-reversion speed kappa = half-life row', '1m', 'none'),
 ('CM', 'Center of Mass', 'MERGE', 'VWAP / volume POC (exist)', '1m', 'Terrain'),
 ('CM', 'Collision', 'MERGE', 'a touch of a wall (wall back-test)', 'OPT+1m', 'none'),
 ('CM', 'Pendulum Period', 'DROP', 'no stable cycle to measure', '-', 'none'),
 ('CM', 'Terminal Velocity', 'MERGE', 'trend exhaustion (RSI-type)', '1m', 'none'),
 # ---- chaos
 ('CH', 'Market Lyapunov', 'DROP', 'Rosenstein largest Lyapunov exponent: unidentifiable on short noisy returns', '1m', 'none'),
 ('CH', 'Hurst Exponent', 'MERGE', 'R/S Hurst -> DFA row', '1m', 'none'),
 ('CH', 'DFA Persistence', 'DROP', 'detrended fluctuation analysis (tested: no continuation edge, not better than variance ratio)', '1m', 'none'),
 ('CH', 'Fractal Dimension', 'MERGE', 'Higuchi / Katz FD (~2 - H)', '1m', 'none'),
 ('CH', 'Multifractal Spectrum', 'RESEARCH', 'MF-DFA spectrum width (needs long windows; daily use only)', '1m', 'none'),
 ('CH', 'Recurrence Rate', 'RESEARCH', 'recurrence quantification analysis (RQA)', '1m', 'none'),
 ('CH', 'Determinism (RQA)', 'MERGE', 'RQA row', '1m', 'none'),
 ('CH', 'Critical Transition Detector', 'MERGE', 'critical slowing down: rising AR(1) + variance (tested: AR(1) part AUC 0.49-0.51 = coin flip; variance part = the vol ratio a HAR already holds)', '1m', 'Pulse'),
 ('CH', 'Correlation Dimension', 'DROP', 'Grassberger-Procaccia: needs far more clean data than exists', '1m', 'none'),
 ('CH', 'Strange Attractor Map', 'DROP', 'visual only', '-', 'none'),
 ('CH', 'Bifurcation Detector', 'MERGE', 'critical transition row', '1m', 'none'),
 ('CH', 'Butterfly Sensitivity', 'DROP', 'no computable definition', '-', 'none'),
 ('CH', 'Kolmogorov-Sinai Entropy', 'DROP', 'not estimable on this data', '-', 'none'),
 ('CH', 'Lacunarity', 'DROP', 'no use in prediction literature', '1m', 'none'),
 ('CH', 'Edge of Chaos Score', 'DROP', 'no computable definition', '-', 'none'),
 ('CH', 'Skewness Rise (EWS)', 'MERGE', 'early-warning skewness = critical transition row', '1m', 'none'),
 ('CH', 'Flickering (EWS)', 'MERGE', 'bimodality early warning = critical transition row', '1m', 'none'),
 ('CH', 'Variance Ratio', 'DROP', 'Lo-MacKinlay variance ratio (the plain persistence measure; tested as the baseline: no edge either)', '1m', 'none'),
 ('CH', 'Fractal Efficiency', 'MERGE', 'Kaufman efficiency ratio', '1m', 'none'),
 ('CH', 'Self-Similarity Score', 'DROP', 'duplicate of Hurst', '1m', 'none'),
 # ---- quantum-inspired
 ('QU', 'Scenario Distributions', 'KEEP', 'risk-neutral density from the chain (Breeden-Litzenberger)', 'OPT', 'Weigher'),
 ('QU', 'Tunneling Probability', 'KEEP', 'probability of touching a level before expiry (barrier-hit ~ 2x delta) vs empirical wall breaks', 'OPT', 'Weigher'),
 ('QU', 'Uncertainty Principle', 'DROP', 'no computable definition', '-', 'none'),
 ('QU', 'Wavefunction Collapse', 'MERGE', 'event IV crush', 'OPT', 'Weigher'),
 ('QU', 'Entanglement', 'MERGE', 'correlation', 'X', 'none'),
 ('QU', 'Quantum States', 'MERGE', 'HMM regime label', 'D', 'Pulse'),
 ('QU', 'Energy Levels', 'MERGE', 'strikes / levels (exist)', 'OPT', 'none'),
 ('QU', 'Spin', 'DROP', 'no computable definition', '-', 'none'),
 ('QU', 'Decoherence', 'MERGE', 'correlation breakdown (absorption-ratio row)', 'X', 'none'),
 ('QU', 'Observer Effect', 'DROP', 'no computable definition', '-', 'none'),
 ('QU', 'Path Integral', 'MERGE', 'Monte-Carlo cone (scenario row)', 'OPT', 'none'),
 ('QU', 'Probability Cloud', 'MERGE', 'implied-move band from the ATM straddle', 'OPT', 'Terrain'),
 ('QU', 'Barrier Penetration Rate', 'MERGE', 'empirical wall break rate (wall back-test)', 'OPT+1m', 'none'),
 ('QU', 'Zero-Point Energy', 'DROP', 'no computable definition', '-', 'none'),
 ('QU', 'Tunneling Time', 'DROP', 'no computable definition', '-', 'none'),
 ('QU', 'Superposition Bias', 'MERGE', 'risk-reversal skew (Compass input)', 'OPT', 'Compass'),
 ('QU', 'Scenario Interference', 'DROP', 'no computable definition', '-', 'none'),
 ('QU', 'Eigenstate Levels', 'DROP', 'no computable definition', '-', 'none'),
 ('QU', 'Heisenberg Spread', 'DROP', 'no computable definition', '-', 'none'),
 ('QU', 'Quantum Momentum', 'DROP', 'no computable definition', '-', 'none'),
 # ---- optics
 ('OP', 'Signal Polarization', 'MERGE', 'agreement of signals -> cross-timeframe alignment row (only meaningful if signals are independent)', '1m', 'none'),
 ('OP', 'Absorption', 'MERGE', 'volume absorbed at a level without a move (Viscosity at the level)', '1m', 'none'),
 ('OP', 'Refraction', 'DROP', 'no computable definition', '-', 'none'),
 ('OP', 'Reflection', 'MERGE', 'bounce at a wall (wall back-test)', 'OPT+1m', 'none'),
 ('OP', 'Lens Focus', 'RESEARCH', 'Herfindahl concentration of gamma / OI across strikes', 'OPT', 'Pinpoint'),
 ('OP', 'Diffraction', 'DROP', 'no computable definition', '-', 'none'),
 ('OP', 'Spectral Lines', 'DROP', 'no computable definition', '-', 'none'),
 ('OP', 'Luminosity', 'MERGE', 'volume vs its intraday curve (Compass input)', '1m', 'Compass'),
 ('OP', 'Opacity', 'DROP', 'off-exchange share: needs TRF-tagged prints; UNAVAILABLE as built', 'TAPE', 'none'),
 ('OP', 'Brightness Index', 'DROP', 'no computable definition', '-', 'none'),
 ('OP', 'Prism', 'DROP', 'flow by participant type: UNAVAILABLE (no participant IDs)', '-', 'none'),
 ('OP', 'Laser Coherence', 'DROP', 'duplicate of polarization', '-', 'none'),
 ('OP', 'Red Shift', 'DROP', 'no computable definition', '-', 'none'),
 ('OP', 'Optical Depth', 'DROP', 'book depth: L2 UNAVAILABLE', 'L2', 'none'),
 ('OP', 'Glare', 'MERGE', 'noise-to-signal = 1 / efficiency ratio', '1m', 'none'),
 ('OP', 'Interference Fringes', 'DROP', 'no computable definition', '-', 'none'),
 ('OP', 'Focal Point', 'DROP', 'no computable definition', '-', 'none'),
 ('OP', 'Shadow', 'DROP', 'hidden liquidity: UNAVAILABLE', 'L2', 'none'),
 ('OP', 'Polarization Filter', 'MERGE', 'signal-agreement filter (polarization row)', '-', 'none'),
 ('OP', 'Transparency Score', 'DROP', 'no computable definition', '-', 'none'),
 # ---- statistical mechanics
 ('SM', 'Market Diffusion', 'MERGE', 'realised variance per unit time; anomalous-diffusion exponent = variance ratio / Hurst', '1m', 'none'),
 ('SM', 'Magnetization', 'RESEARCH', 'breadth: share of constituents / sectors moving with the index', 'X', 'Pulse'),
 ('SM', 'Correlation Decomposition', 'RESEARCH', 'PCA absorption ratio (Kritzman et al.)', 'X', 'Pulse'),
 ('SM', 'Random-Matrix Filtering', 'RESEARCH', 'Marchenko-Pastur eigenvalue cleaning (portfolio tool)', 'X', 'none'),
 ('SM', 'Systemic Stress', 'MERGE', 'absorption ratio / turbulence', 'X', 'none'),
 ('SM', 'Ising Herding', 'DROP', 'a model, not an indicator', '-', 'none'),
 ('SM', 'Partition Function', 'DROP', 'no computable definition', '-', 'none'),
 ('SM', 'Boltzmann Returns', 'DROP', 'a distribution fit, not a signal', '-', 'none'),
 ('SM', 'Mean Free Path', 'MERGE', 'time between directional changes = intrinsic-time row', '1m', 'none'),
 ('SM', 'Brownian Drift', 'DROP', 'mean return (no information)', '-', 'none'),
 ('SM', 'Fokker-Planck Density', 'MERGE', 'scenario-distribution row', 'OPT', 'none'),
 ('SM', 'Critical Temperature', 'DROP', 'no computable definition', '-', 'none'),
 ('SM', 'Susceptibility', 'MERGE', 'beta to SPY', 'X', 'none'),
 ('SM', 'Order Parameter', 'MERGE', 'magnetization row', 'X', 'none'),
 ('SM', 'Percolation', 'DROP', 'no computable definition', '-', 'none'),
 ('SM', 'Detailed Balance', 'RESEARCH', 'time-irreversibility test (low priority)', '1m', 'none'),
 ('SM', 'Fluctuation-Dissipation', 'DROP', 'no computable definition', '-', 'none'),
 ('SM', 'Equipartition', 'DROP', 'no computable definition', '-', 'none'),
 ('SM', 'Mean-Field Pressure', 'DROP', 'no computable definition', '-', 'none'),
 ('SM', 'Correlation Regime', 'MERGE', 'rolling cross-asset correlation (absorption-ratio row)', 'X', 'none'),
 # ---- astrophysics
 ('AS', 'Gravity Well', 'DROP', 'strike pinning to the largest-gamma strike (tested on the rebuilt SPY book: no attraction, slight drift away; pull direction n.s.)', 'OPT+1m', 'none'),
 ('AS', 'Market Clock', 'KEEP', 'intrinsic time: volume / directional-change bars (Guillaume et al.)', '1m', 'Terrain'),
 ('AS', 'Gravitational Wave Scanner', 'KEEP', 'market-to-single-name volatility spillover (HAR-X; tested: +0.6-1.0pp R2 on AAPL, ~+0.15 on NVDA, ~0.1 between ETFs)', 'X', 'Compass-retrain'),
 ('AS', 'Event Horizon', 'DROP', 'no computable definition', '-', 'none'),
 ('AS', 'Black Hole', 'DROP', 'no computable definition', '-', 'none'),
 ('AS', 'Orbit', 'MERGE', 'oscillation around a level = pinning row', 'OPT+1m', 'none'),
 ('AS', 'Escape Trajectory', 'MERGE', 'escape-velocity row', '1m', 'none'),
 ('AS', 'Supernova', 'RESEARCH', 'jump detection (Lee-Mykland / bipower variation)', '1m', 'Pulse'),
 ('AS', 'Dark Matter', 'DROP', 'unseen positioning: UNAVAILABLE by definition', '-', 'none'),
 ('AS', 'Dark Energy', 'DROP', 'no computable definition', '-', 'none'),
 ('AS', 'Redshift', 'DROP', 'no computable definition', '-', 'none'),
 ('AS', 'Tidal Force', 'MERGE', 'expiry charm / gamma roll-off (Capacitance row)', 'OPT', 'none'),
 ('AS', 'Lagrange Points', 'DROP', 'midpoint between walls: no evidence of meaning', 'OPT', 'none'),
 ('AS', 'Solar Wind', 'DROP', 'no computable definition', '-', 'none'),
 ('AS', 'Gravitational Lensing', 'DROP', 'no computable definition', '-', 'none'),
 ('AS', 'Orbital Period', 'DROP', 'no stable cycle', '-', 'none'),
 ('AS', 'Cosmic Background', 'MERGE', 'noise floor (Thermal Noise Floor row)', '1m', 'none'),
 ('AS', 'Accretion', 'MERGE', 'OI build-up by strike (book/oiChange exists)', 'OPT', 'Pinpoint'),
 ('AS', 'Shock Propagation', 'MERGE', 'cross-asset lead-lag = Gravitational Wave Scanner row', 'X', 'none'),
 ('AS', 'Planetary Alignment', 'MERGE', 'multi-asset alignment = magnetization row', 'X', 'none'),
]


def main():
    assert len(R) == 200, len(R)
    os.makedirs(RESULTS, exist_ok=True)
    with open(os.path.join(RESULTS, 'indicator_triage.csv'), 'w', newline='') as f:
        w = csv.writer(f)
        w.writerow(['id', 'name', 'family', 'verdict', 'standard_name', 'data_needed', 'slayer_page'])
        for k, (fam, name, v, std, data, page) in enumerate(R, 1):
            w.writerow([k, name, F[fam], v, std, data, page])
    from collections import Counter
    print(Counter(v for _, _, v, *_ in R))
    for fam in F:
        print(F[fam], dict(Counter(v for f2, _, v, *_ in R if f2 == fam)))


if __name__ == '__main__':
    main()
