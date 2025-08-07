import { useState } from 'react';
import Canvas from './Canvas';

function App() {
  const [constraints, setConstraints] = useState<any[]>([]);
  const [transform, setTransform] = useState<
    | { type: 'similarity'; params: [number, number, number, number] }
    | { type: 'affine'; params: [number, number, number, number, number, number] }
    | null
  >(null);

  const solveSimilarity = () => {
    // Demo params: s=1.15, theta=0.15 rad, tx=30, ty=-20
    setTransform({ type: 'similarity', params: [1.15, 0.15, 30, -20] });
  };

  const solveAffine = () => {
    // Demo affine: slight shear/scale and translate
    setTransform({ type: 'affine', params: [1.05, 0.12, -0.08, 0.95, 25, -15] });
  };

  return (
    <div className="container">
      <div className="canvas-container">
        <Canvas overlayTransform={transform} />
        <Canvas overlayTransform={null} />
      </div>
      <div className="side-panel">
        <h2>Constraints</h2>
        <div style={{ marginBottom: 8 }}>
          <button onClick={solveSimilarity}>Solve Similarity</button>
          <button onClick={solveAffine}>Solve Affine</button>
          <button onClick={() => setTransform(null)} style={{ marginLeft: 6 }}>Clear</button>
        </div>
        <ul>
          {constraints.map((c, i) => (
            <li key={i}>{JSON.stringify(c)}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export default App;
