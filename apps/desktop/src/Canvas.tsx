import React, { useRef, useEffect } from 'react';

const Canvas = props => {

  const canvasRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas.getContext('2d');
    const { width, height } = canvas.getBoundingClientRect();

    const scale = window.devicePixelRatio;
    canvas.width = width * scale;
    canvas.height = height * scale;
    context.scale(scale, scale);

    //Our first draw
    context.fillStyle = '#000000'
    context.fillRect(0, 0, width, height)
  }, [])

  return <canvas ref={canvasRef} style={{ width: '100%', height: '100%' }} {...props}/>
}

export default Canvas
