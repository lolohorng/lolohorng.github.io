var Example = Example || {};

Example.mixed = function() {
    var Engine = Matter.Engine,
        Body = Matter.Body,
        Render = Matter.Render,
        Runner = Matter.Runner,
        Composites = Matter.Composites,
        Common = Matter.Common,
        MouseConstraint = Matter.MouseConstraint,
        Mouse = Matter.Mouse,
        Composite = Matter.Composite,
        Bodies = Matter.Bodies,
        Events = Matter.Events;

    var sceneElement = document.getElementById('scene');
    var heroCopyElement = document.querySelector('.hero-copy');

    // List of SVG assets to use for bodies
    var assetImages = [
        'Group 21.svg', 'Group 22.svg', 'Group 23.svg', 'Group 24.svg', 'Group 25.svg',
        'Group 26.svg', 'Group 27.svg', 'Group 28.svg', 'Group 29.svg', 'Group 30.svg',
        'Vector-1.svg', 'Vector-3.svg', 'Vector-4.svg', 'Vector-5.svg',
        'Vector-6.svg', 'Vector-9.svg'
    ];

    // Preload images and capture native dimensions
    var images = {};
    var imageSizes = {};
    var loadedImages = 0;
    var bodyScale = 0.26;   // smaller collision box size
    var drawScale = 0.27;   // rendered asset size
    var heroBorderBody = null;

    function updateRectBody(body, centerX, centerY, bodyWidth, bodyHeight) {
        Body.setPosition(body, { x: centerX, y: centerY });
        Body.setVertices(body, [
            { x: centerX - bodyWidth / 2, y: centerY - bodyHeight / 2 },
            { x: centerX + bodyWidth / 2, y: centerY - bodyHeight / 2 },
            { x: centerX + bodyWidth / 2, y: centerY + bodyHeight / 2 },
            { x: centerX - bodyWidth / 2, y: centerY + bodyHeight / 2 }
        ]);
    }

    function getHeroBounds(element) {
        if (!sceneElement || !element) {
            return null;
        }

        var sceneRect = sceneElement.getBoundingClientRect();
        var heroRect = element.getBoundingClientRect();
        var padding = 60;

        return {
            x: heroRect.left - sceneRect.left - padding,
            y: heroRect.top - sceneRect.top - padding,
            width: heroRect.width + padding * 2,
            height: heroRect.height + padding * 2
        };
    }

    function syncHeroBorder() {
        if (!heroCopyElement) {
            return;
        }

        var bounds = getHeroBounds(heroCopyElement);

        if (!bounds) {
            return;
        }

        var centerX = bounds.x + bounds.width / 2;
        var centerY = bounds.y + bounds.height / 2;

        if (!heroBorderBody) {
            heroBorderBody = Bodies.rectangle(centerX, centerY, bounds.width, bounds.height, {
                isStatic: true,
                render: {
                    visible: false,
                    fillStyle: 'transparent',
                    strokeStyle: 'transparent',
                    lineWidth: 2
                }
            });

            Composite.add(world, heroBorderBody);
            return;
        }

        updateRectBody(heroBorderBody, centerX, centerY, bounds.width, bounds.height);
    }

    function tryCreateBodies() {
        if (loadedImages !== assetImages.length) {
            return;
        }

        // add bodies - one for each image asset, positioned randomly in a heap
        var bodies = [];
        var heapWidth = 250; // width of the heap area
        var heapHeight = 300; // height of the heap area
        var centerX = width * 0.3;
        var centerY = height / 2;

        for (var i = 0; i < assetImages.length; i++) {
            // Random position within the heap area
            var x = centerX + (Math.random() - 0.5) * heapWidth;
            var y = centerY + (Math.random() - 0.5) * heapHeight;
            var nativeSize = imageSizes[assetImages[i]] || { width: 60, height: 60 };
            var radius = Math.min(nativeSize.width, nativeSize.height) * bodyScale * 0.5;

            var body = Bodies.circle(x, y, radius, {
                label: assetImages[i],
                friction: 0.5,
                restitution: 0.1,
                render: {
                    visible: false,
                    fillStyle: 'transparent',
                    strokeStyle: 'transparent'
                }
            });
            bodies.push(body);
        }

        Composite.add(world, bodies);
    }

    // create engine
    var engine = Engine.create(),
        world = engine.world;

    // create renderer
    var navHeight = 40;
    var width = window.innerWidth;
    var height = window.innerHeight - navHeight;
    
    var render = Render.create({
        element: document.getElementById('scene'),
        engine: engine,
        options: {
            width: width,
            height: height,
            wireframes: false,
            wireframeBackground: false,
            showAngleIndicator: false,
        }
    });

    var canvas = render.canvas;
    var ctx = canvas.getContext('2d');

    Render.run(render);

    // create runner
    var runner = Runner.create();
    Runner.run(runner, engine);

    assetImages.forEach(function(filename) {
        var img = new Image();
        img.onload = function() {
            imageSizes[filename] = {
                width: img.naturalWidth || img.width || 60,
                height: img.naturalHeight || img.height || 60
            };
            loadedImages += 1;
            tryCreateBodies();
        };
        img.src = 'assets_new/' + filename;
        images[filename] = img;
    });

    Composite.add(world, [
        Bodies.rectangle(width / 2, 0, width, 50, {
            isStatic: true,
            render: {
                visible: false,
                fillStyle: 'transparent',
                strokeStyle: 'transparent'
            }
        }),
        Bodies.rectangle(width / 2, height, width, 50, {
            isStatic: true,
            render: {
                visible: false,
                fillStyle: 'transparent',
                strokeStyle: 'transparent'
            }
        }),
        Bodies.rectangle(width, height / 2, 50, height, {
            isStatic: true,
            render: {
                visible: false,
                fillStyle: 'transparent',
                strokeStyle: 'transparent'
            }
        }),
        Bodies.rectangle(0, height / 2, 50, height, {
            isStatic: true,
            render: {
                visible: false,
                fillStyle: 'transparent',
                strokeStyle: 'transparent'
            }
        })
    ]);

    syncHeroBorder();

    if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(function() {
            syncHeroBorder();
        });
    }

    window.addEventListener('resize', function() {
        syncHeroBorder();
    });

    // add mouse control
    var mouse = Mouse.create(render.canvas),
        mouseConstraint = MouseConstraint.create(engine, {
            mouse: mouse,
            constraint: {
                stiffness: 0.2,
                render: {
                    visible: false
                }
            }
        });

    Composite.add(world, mouseConstraint);

    // keep the mouse in sync with rendering
    render.mouse = mouse;

    // fit the render viewport to the scene
    Render.lookAt(render, {
        min: { x: 0, y: 0 },
        max: { x: width, y: height }
    });

    // Custom rendering for images
    Events.on(render, 'afterRender', function() {
        var bodies = Composite.allBodies(world);

        bodies.forEach(function(body) {
            if (body.label && images[body.label] && images[body.label].complete) {
                var img = images[body.label];
                var pos = body.position;
                var angle = body.angle;
                var nativeSize = imageSizes[body.label] || { width: img.naturalWidth || img.width || 60, height: img.naturalHeight || img.height || 60 };
                var size = {
                    width: nativeSize.width * drawScale,
                    height: nativeSize.height * drawScale
                };
                
                // Save canvas context
                ctx.save();
                
                // Translate and rotate
                ctx.translate(pos.x, pos.y);
                ctx.rotate(angle);
                
                // Draw image centered using the scaled dimensions
                ctx.drawImage(img, -size.width / 2, -size.height / 2, size.width, size.height);
                
                // Restore canvas context
                ctx.restore();
            }
        });
    });

    // context for MatterTools.Demo
    return {
        engine: engine,
        runner: runner,
        render: render,
        canvas: render.canvas,
        stop: function() {
            Matter.Render.stop(render);
            Matter.Runner.stop(runner);
        }
    };
};

Example.mixed.title = 'Mixed Shapes';
Example.mixed.for = '>=0.14.2';

if (typeof module !== 'undefined') {
    module.exports = Example.mixed;
}





