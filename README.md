# Asset Allocation Monte Carlo Simulator

## Project Vision
* Build a Monte Carlo simulator specifically for retail investors.
* Run all calculations directly in the browser (client-side).
* Keep infrastructure costs at zero by using static hosting.
* Guarantee complete user privacy by not sending data to a server.
* Provide a fast, interactive, and real-time user interface.

## Main Goals
* Use modern web technologies like Web Workers and TypedArrays to run thousands of simulations without freezing the interface.
* Implement accurate mathematical models for asset correlation and risk metrics.
* Update charts and data instantly when the user changes inputs like portfolio weights or time horizons.
* Use a curated dataset to keep download sizes small and optimize performance.

## Data Architecture
* **Selected Dataset:** 
  * Avoid downloading the entire stock market. 
  * Use a static, compressed file (Parquet or JSON) containing the 200 to 300 most popular tickers and ETFs.
* **Backfilling via Asset-Class Proxy:** 
  * Handle new ETFs that lack long historical data.
  * Map new funds to their parent index to fill in missing past data.
  * Example: Use MSCI World data to simulate the history of a recent global ETF during the 2008 and 2000 crashes.
* **Data Frequency:** 
  * Set monthly data as the default for the best balance of speed and long-term accuracy.
  * Offer weekly data as an advanced option.
* **Inflation and Risk-Free Rates:** 
  * Include historical Consumer Price Index (CPI) and risk-free rate data.
  * Allow users to switch between nominal returns and real, inflation-adjusted returns.

## Simulation Engines
* **Historical Joint Bootstrap:** 
  * Extract returns for all portfolio assets from the same random historical month.
  * Keep the real market correlation intact.
  * Preserve extreme market events and real return distributions.
* **Parametric Simulation:** 
  * Generate random paths based on expected returns and a covariance matrix.
  * Include a mathematical correction tool (Higham's Algorithm).
  * Ensure the covariance matrix is always valid for calculations to prevent the simulation from crashing.

## Portfolio Logic and Cash Flows
* **Contributions:** Allow users to choose between a lump sum investment or a recurring investment plan (Dollar Cost Averaging).
* **Taxes:** Calculate capital gains taxes automatically.
* **Rebalancing Methods:**
  * **Time-based:** Rebalance on a fixed schedule (e.g., every year or every 6 months).
  * **Tolerance Bands:** Rebalance only when an asset moves away from its target weight by a specific percentage (e.g., more than 5%). This requires more calculations but simulates real-world tax and fee optimization.

## Visualization and Metrics
* **Optimized Charts:**
  * Avoid heavy "spaghetti plots" that slow down the browser.
  * Display a quantile band chart showing the 10th, 25th, 50th, 75th, and 90th percentiles.
  * Limit the display to a maximum of 50 individual line paths.
* **Interactive Highlights:**
  * Allow the user to click on a specific simulation line or percentile band.
  * Show the exact sequence of returns and drawdowns that led to that specific final value.
* **Key Metrics Panel:**
  * Show Compound Annual Growth Rate (CAGR) percentiles.
  * Display Maximum Drawdown (both historical and simulated).
  * Calculate Sharpe Ratio and portfolio volatility.
* **Data Export:**
  * Provide a CSV download feature.
  * Allow users to export summary metrics or raw simulation data for external analysis in Excel or Python.