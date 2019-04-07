import { NgIf } from '@angular/common';
import {
  Component,
  EventEmitter,
  Input,
  NgModule,
  OnInit,
  Output,
} from '@angular/core';
import {
  _renderingCache,
  InvalidInputBindError,
  InvalidStaticPropertyMockError,
  Renderer,
} from './renderer';
import { TestSetup } from './test-setup';

class TestUtility { // tslint:disable-line no-unnecessary-class
  static readonly staticNumber = 123;
  static staticMethod() { return 'foo'; }
}

const staticObject = {
  staticNumber: 123,
  staticMethod: () => 'foo',
};

@Component({
  selector: 'thing',
  template: `
    <div>{{myInput}}</div>
    <span>{{promiseResult}}</span>
  `
})
class TestComponent implements OnInit {
  @Input('renamedInput') fooInput: string;
  @Input() myInput: string;
  myProperty: string;
  @Output() myOutput = new EventEmitter<any>();
  emitterWithoutOutputDecorator = new EventEmitter<any>();
  promiseResult: string;

  async ngOnInit() {
    this.promiseResult = await Promise.resolve('Promise Result');
  }
}

@NgModule({
  declarations: [TestComponent]
})
class TestModule {}

describe('Renderer', () => {
  let renderer: Renderer<TestComponent>;
  let setup: TestSetup<TestComponent>;
  beforeEach(() => {
    setup = new TestSetup(TestComponent, TestModule);
    setup.dontMock.push(TestComponent);
    renderer = new Renderer(setup);
  });

  it('mocks static CLASS methods from the test setup', async () => {
    setup.staticMocks.set(TestUtility, {staticMethod: () => 'mocked foo'});
    await renderer.render();

    expect(TestUtility.staticMethod()).toBe('mocked foo');
  });

  it('mocks static OBJECT methods from the test setup', async () => {
    setup.staticMocks.set(staticObject, {staticMethod: () => 'mocked foo'});
    await renderer.render();

    expect(staticObject.staticMethod()).toBe('mocked foo');
  });

  it('mocks static CLASS properties throws an error', async () => {
    setup.staticMocks.set(TestUtility, {staticNumber: 999});

    try {
      await renderer.render();
      fail('render should have thrown an error');
    } catch (e) {
      expect(e instanceof InvalidStaticPropertyMockError).toBe(true);
    }
  });

  it('mocks static OBJECT properties throws an error', async () => {
    setup.staticMocks.set(staticObject, {staticNumber: 999});

    try {
      await renderer.render();
      fail('render should have thrown an error');
    } catch (e) {
      expect(e instanceof InvalidStaticPropertyMockError).toBe(true);
    }
  });

  it('spys on output event emitters', async () => {
    const {instance} = await renderer.render();
    instance.myOutput.emit('FOO');

    // Spys have a `calls` property on them. This is the only way I know
    // how to detect an existing spy.
    expect((instance.myOutput.emit as jasmine.Spy).calls).toBeDefined();
    expect(instance.myOutput.emit).toHaveBeenCalledWith('FOO');
  });

  it('does not spy on event emitters that are not marked as @Output', async () => {
    const {instance} = await renderer.render();
    instance.emitterWithoutOutputDecorator.emit('FOO');

    // Spys have a `calls` property on them. This is the only way I know
    // how to detect an existing spy.
    expect((instance.emitterWithoutOutputDecorator.emit as jasmine.Spy).calls)
      .not.toBeDefined();
  });

  describe('with only template', () => {
    it('wraps the rendering in a container', async () => {
      const {fixture} = await renderer.render('<thing></thing>');

      expect(fixture.debugElement.children[0].componentInstance instanceof TestComponent).toBe(true);
    });
  });

  describe('with no arguments', () => {
    it('wraps the rendering in a container', async () => {
      const {fixture} = await renderer.render();

      expect(fixture.debugElement.children[0].componentInstance instanceof TestComponent).toBe(true);
    });

  });

  describe('with only renderOptions', () => {
    it('wraps the rendering in a container', async () => {
      const {fixture} = await renderer.render({});

      expect(fixture.debugElement.children[0].componentInstance instanceof TestComponent).toBe(true);
    });

    it('binds through the wrapper to the component', async () => {
      const {instance} = await renderer.render({
        bind: {myInput: 'FOO'}
      });

      expect(instance.myInput).toBe('FOO');
    });

    it('works on renamed @Input properties', async () => {
      await renderer.render({
        bind: {fooInput: 'FOO'}
      });
    });

    it('throws an error when binding to a property that is not marked as an @Input', async (done) => {
      try {
        await renderer.render({
          bind: {myProperty: 'FOO'}
        });
        fail('Render should have thrown an error because the myProperty is not an @Input');
      } catch (e) {
        expect(e instanceof InvalidInputBindError).toBe(true);
        done();
      }
    });
  });

  describe('whenStable', () => {
    it('is awaited by default', async () => {
      const {find} = await renderer.render();

      expect(find('span').nativeElement.textContent).toBe('Promise Result');
    });

    it('is not awaited when disabled in options', async () => {
      const {find} = await renderer.render({whenStable: false});

      expect(find('span').nativeElement.textContent).toBe('');
    });
  });

  describe('detectChanges', () => {
    it('is detected by default', async () => {
      const {find} = await renderer.render({
        bind: {myInput: 'FOO'}
      });

      expect(find('div').nativeElement.textContent).toBe('FOO');
    });

    it('is not detected when disabled in options', async () => {
      const {find} = await renderer.render({
        detectChanges: false,
        bind: {myInput: 'FOO'}
      });

      expect(find('div').nativeElement.textContent).toBe('');
    });
  });

  describe('structural directives', () => {
    it('element is the first child element when testing a structural directive', async () => {
      const myRenderer = new Renderer(new TestSetup(NgIf, TestModule));
      const {element} = await myRenderer.render('<b *ngIf="true"></b>');

      expect(element.nativeElement.tagName).toBe('B');
    });

    it('element is undefined when the structural directive does not render an element', async () => {
      const myRenderer = new Renderer(new TestSetup(NgIf, TestModule));
      const {element} = await myRenderer.render('<b *ngIf="false"></b>');

      expect(element).not.toBeDefined();
    });

    it('instance is the directive instance when testing a structural directive', async () => {
      const myRenderer = new Renderer(new TestSetup(NgIf, TestModule));
      const {instance} = await myRenderer.render('<b *ngIf="true"></b>');

      expect(instance instanceof NgIf).toBe(true);
    });
  });

  describe('Caching', () => {
    beforeAll(() => _renderingCache.clear());

    it('should be able to set up a component for the first time', async () => {
      const template = '<thing myInput="a" renamedInput="b"></thing>';
      await renderer.render(template);

      expect(_renderingCache.size).toEqual(1);
    });

    it('should reuse a cached instance if possible', async () => {
      const template = '<thing myInput="a" renamedInput="b"></thing>';
      await renderer.render(template);

      expect(_renderingCache.size).toEqual(1);
    });

    it('should have an cached entry for each configuration', async () => {
      const template = '<thing myInput="x" renamedInput="y"></thing>';
      await renderer.render(template);

      expect(_renderingCache.size).toEqual(2);
    });
  });
});
