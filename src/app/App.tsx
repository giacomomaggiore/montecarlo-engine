import { Navigate, NavLink, Route, Routes } from 'react-router-dom'
import { EducationPage } from '../features/education/EducationPage'
import { ResourcesPage } from '../features/resources/ResourcesPage'
import { SimulatorPage } from '../features/simulator/SimulatorPage'

const navigation = [
  { to: '/', label: 'Engine', end: true },
  { to: '/education', label: 'Educational', end: false },
  { to: '/resources', label: 'External Resources', end: false },
] as const

export function App() {
  return (
    <div className="app-shell">
      <header className="site-header">
        <a className="product-name" href="/">
          Asset Allocation Monte Carlo Simulator
        </a>
        <nav aria-label="Primary navigation">
          {navigation.map((item) => (
            <NavLink
              className={({ isActive }) =>
                isActive ? 'active-nav-link' : 'nav-link'
              }
              end={item.end}
              key={item.to}
              to={item.to}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      </header>
      <main>
        <Routes>
          <Route path="/" element={<SimulatorPage />} />
          <Route
            path="/education"
            element={<Navigate replace to="/education/foundations" />}
          />
          <Route path="/education/:chapterSlug" element={<EducationPage />} />
          <Route path="/resources" element={<ResourcesPage />} />
        </Routes>
      </main>
    </div>
  )
}
