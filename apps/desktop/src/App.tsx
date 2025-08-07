import { useState } from 'react';

import Canvas from './Canvas';

function App() {
  const [constraints, setConstraints] = useState([]);

  return (
    <div className="container">
      <div className="canvas-container">
        <Canvas />
        <Canvas />
      </div>
      <div className="side-panel">
        <h2>Constraints</h2>
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
