import { createRoot } from 'react-dom/client';
import FinesChart from './FinesChart.jsx';
import './fines-chart.css';

const el = document.getElementById('fines-chart-root');
if (el) {
  createRoot(el).render(<FinesChart />);
}
